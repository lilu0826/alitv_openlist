// Cloudflare Workers 版实现，逻辑与 Go 版本保持一致

const CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";

// ---------- MD5 ----------

const MD5_SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
}

function rotl32(x, c) {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

export function md5Hex(input) {
  const text = new TextEncoder().encode(input);
  const blockCount = Math.ceil((text.length + 9) / 64);
  const total = blockCount * 64;
  const buf = new Uint8Array(total);
  buf.set(text);
  buf[text.length] = 0x80;

  const view = new DataView(buf.buffer);
  const bitLen = text.length * 8;
  view.setUint32(total - 8, bitLen >>> 0, true);
  view.setUint32(total - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Uint32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(off + j * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F;
      let g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) & 15;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) & 15;
      }

      const tmp = D;
      D = C;
      C = B;
      const sum = (A + F + MD5_K[i] + M[g]) >>> 0;
      B = (B + rotl32(sum, MD5_SHIFT[i])) >>> 0;
      A = tmp;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  let hex = "";
  for (const w of [a0, b0, c0, d0]) {
    for (let i = 0; i < 4; i++) {
      hex += ((w >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
    }
  }
  return hex;
}

// ---------- 基础工具 ----------

function randomString(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += CHARSET[bytes[i] % CHARSET.length];
  return out;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToBytes(hex) {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("iv 解码失败");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function importAesKey(keyStr) {
  const keyBytes = new TextEncoder().encode(keyStr);
  if (keyBytes.length !== 32) throw new Error("key 长度必须为 32 字节（AES-256）");
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
}

async function encrypt(plaintext, ivStr, keyStr) {
  const iv = new TextEncoder().encode(ivStr);
  if (iv.length !== 16) throw new Error("IV 长度必须为 16 字节（128 位）");
  const key = await importAesKey(keyStr);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return bytesToBase64(new Uint8Array(ciphertext));
}

async function decrypt(ciphertextB64, ivHex, keyStr) {
  const iv = hexToBytes(ivHex);
  if (iv.length !== 16) throw new Error("IV 长度必须为 16 字节（128 位）");
  const key = await importAesKey(keyStr);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv },
    key,
    base64ToBytes(ciphertextB64),
  );
  return new TextDecoder().decode(plaintext);
}

// ---------- 签名与请求参数 ----------

function abs(x) {
  return x < 0 ? -x : x;
}

function h(charArray, modifier) {
  const uniqueMap = new Set();
  const uniqueChars = [];
  for (const c of charArray) {
    if (!uniqueMap.has(c)) {
      uniqueMap.add(c);
      uniqueChars.push(c);
    }
  }

  const modStr = String(modifier);
  if (modStr.length < 7) throw new Error("modifier 字符串长度不足7");
  const numericModifier = parseInt(modStr.slice(7), 10);
  if (Number.isNaN(numericModifier)) throw new Error("modifier 不是数字");

  let out = "";
  for (const char of uniqueChars) {
    let newCharCode = char.codePointAt(0) - (numericModifier % 127) - 1;
    newCharCode = abs(newCharCode);
    if (newCharCode < 33) newCharCode += 33;
    out += String.fromCharCode(newCharCode);
  }
  return out;
}

function getParams(t) {
  return {
    akv: "2.8.1496",
    apv: "1.4.1",
    b: "vivo",
    d: "2c7d30cd7ae5e8017384988393f397c6",
    m: "V2329A",
    n: "V2329A",
    mac: "",
    wifiMac: "00db00200063",
    nonce: "",
    t: String(t),
  };
}

function generateKey(t) {
  const params = getParams(t);
  const keys = Object.keys(params).sort();
  let concatenated = "";
  for (const k of keys) {
    if (k !== "t") concatenated += params[k];
  }
  return md5Hex(h(Array.from(concatenated), t));
}

async function getSign(apiPath, t) {
  const params = getParams(t);
  const key = generateKey(t);
  const data = `POST-/api${apiPath}-${t}-${params.d}-${key}`;
  return sha256Hex(data);
}

function localTimestamp() {
  return String(Math.floor(Date.now() / 1000));
}

async function getTimestamp() {
  try {
    const resp = await fetch("https://api.extscreen.com/timestamp");
    if (!resp.ok) return localTimestamp();
    const data = await resp.json();
    if (data.code !== 200 || !data.data || typeof data.data.timestamp !== "number") {
      return localTimestamp();
    }
    return String(Math.trunc(data.data.timestamp));
  } catch {
    return localTimestamp();
  }
}

async function generateRequestInfo(apiPath, body) {
  const t = await getTimestamp();
  const key = generateKey(t);
  const headers = getParams(t);
  const iv = randomString(16);
  const ciphertext = await encrypt(JSON.stringify(body), iv, key);

  headers["Content-Type"] = "application/json";
  headers["sign"] = await getSign(apiPath, t);

  return {
    headers,
    body: { ciphertext, iv },
    key,
  };
}

// ---------- 业务接口 ----------

export async function getQRCode() {
  try {
    const requestInfo = await generateRequestInfo("/v2/qrcode", {
      scopes: "user:base,file:all:read,file:all:write",
      width: 500,
      height: 500,
    });

    const resp = await fetch("https://api.extscreen.com/aliyundrive/v2/qrcode", {
      method: "POST",
      headers: requestInfo.headers,
      body: JSON.stringify(requestInfo.body),
    });
    if (!resp.ok) return { status: 500, body: { error: "Failed to generate QR code" } };

    const result = await resp.json();
    const plain = await decrypt(result.data.ciphertext, result.data.iv, requestInfo.key);
    const qrcodeInfo = JSON.parse(plain);

    return { status: 200, body: { qr_link: qrcodeInfo.qrCodeUrl, sid: qrcodeInfo.sid } };
  } catch (err) {
    return { status: 500, body: { error: String(err) } };
  }
}

export async function handleToken(body) {
  try {
    const requestInfo = await generateRequestInfo("/v4/token", body);
    const resp = await fetch("https://api.extscreen.com/aliyundrive/v4/token", {
      method: "POST",
      headers: requestInfo.headers,
      body: JSON.stringify(requestInfo.body),
    });

    if (!resp.ok) {
      return { status: 200, body: { refresh_token: "", access_token: "", text: "Failed to refresh token" } };
    }

    const tokenData = await resp.json();
    const plain = await decrypt(tokenData.data.ciphertext, tokenData.data.iv, requestInfo.key);
    const token = JSON.parse(plain);

    return {
      status: 200,
      body: { refresh_token: token.refresh_token, access_token: token.access_token, text: "" },
    };
  } catch (err) {
    return { status: 200, body: { refresh_token: "", access_token: "", text: String(err) } };
  }
}

export async function checkStatus(sid) {
  if (!sid) return { status: 400, body: { error: "invalid sid" } };

  try {
    const resp = await fetch(`https://openapi.alipan.com/oauth/qrcode/${encodeURIComponent(sid)}/status`);
    if (!resp.ok) return { status: 500, body: { error: "Failed to check status" } };

    const statusData = await resp.json();
    if (statusData.status === "LoginSuccess") {
      return handleToken({ code: statusData.authCode });
    }
    return { status: 200, body: statusData };
  } catch {
    return { status: 500, body: { error: "Failed to check status" } };
  }
}

export async function getTokenByRefresh(refreshToken) {
  if (!refreshToken) {
    return {
      status: 200,
      body: { refresh_token: "", access_token: "", text: "refresh_ui parameter is required" },
    };
  }
  return handleToken({ refresh_token: refreshToken });
}
