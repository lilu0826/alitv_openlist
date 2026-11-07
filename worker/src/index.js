import indexHtml from "../../index.html";
import { getQRCode, checkStatus, getTokenByRefresh, handleToken } from "./core.js";

function jsonResponse(result) {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(indexHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/qr" && request.method === "GET") {
        return jsonResponse(await getQRCode());
      }

      if (url.pathname === "/check" && request.method === "GET") {
        return jsonResponse(await checkStatus(url.searchParams.get("sid")));
      }

      if (url.pathname === "/token" && request.method === "GET") {
        return jsonResponse(await getTokenByRefresh(url.searchParams.get("refresh_ui")));
      }

      if (url.pathname === "/token" && request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const refreshToken = body?.refresh_token || "";
        if (!refreshToken) {
          return jsonResponse({
            status: 200,
            body: { refresh_token: "", access_token: "", text: "refresh_token parameter is required" },
          });
        }
        return jsonResponse(await handleToken({ refresh_token: refreshToken }));
      }

      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
  },
};
