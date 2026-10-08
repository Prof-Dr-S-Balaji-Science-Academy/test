/* ─────────────────────────────────────────────────────────────────────
 * imagekit-auth  (Cloudflare Worker, Phase 4)
 * Paste this whole file into the Worker via  Edit code  and Deploy.
 *
 * Two actions, both for ProfAdmin only:
 *   POST /sign    -> returns a short-lived ImageKit upload signature
 *   POST /delete  -> deletes one image from ImageKit by its file ID
 *
 * Every request must carry the signed-in person's Firebase ID token:
 *   Authorization: Bearer <token>
 * The Worker (1) verifies the token against Google's public keys and
 * (2) asks Firestore whether admins/<that email> exists, using the same
 * token, so the Firestore rules decide. Anyone else is refused.
 *
 * Settings (Worker -> Settings -> Variables and Secrets):
 *   IMAGEKIT_PRIVATE_KEY   Secret
 *   IMAGEKIT_PUBLIC_KEY    Text
 *   FIREBASE_PROJECT_ID    Text   (profbalaji-scienceacademy)
 *   ALLOWED_ORIGINS        Text   (comma separated, no spaces)
 * ───────────────────────────────────────────────────────────────────── */

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let jwksCache = { keys: null, until: 0 };

const enc = new TextEncoder();

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim().replace(/\/$/, "")).filter(Boolean);
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function reply(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { "Content-Type": "application/json", ...(origin ? corsHeaders(origin) : {}) }
  });
}

async function getJwks() {
  const now = Date.now();
  if (jwksCache.keys && now < jwksCache.until) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("Could not load Google signing keys");
  const data = await res.json();
  jwksCache = { keys: data.keys || [], until: now + 60 * 60 * 1000 };
  return jwksCache.keys;
}

/* Returns the token's claims, or null if it is not a valid Firebase ID token. */
async function verifyFirebaseToken(token, projectId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  let header, claims;
  try { header = b64urlToJson(parts[0]); claims = b64urlToJson(parts[1]); } catch (e) { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;

  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== projectId) return null;
  if (claims.iss !== "https://securetoken.google.com/" + projectId) return null;
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.iat !== "number" || claims.iat > now + 300) return null;
  if (!claims.sub || typeof claims.sub !== "string") return null;
  if (!claims.email || claims.email_verified !== true) return null;
  return claims;
}

/* ProfAdmin = admins/<email> exists. The Firestore rules answer, using the
 * caller's own token (a signed-in person may read only their own entry). */
async function isAdmin(token, email, projectId) {
  const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(projectId)
    + "/databases/(default)/documents/admins/" + encodeURIComponent(email);
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  return res.status === 200;
}

async function hmacSha1Hex(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const origin = (request.headers.get("Origin") || "").replace(/\/$/, "");
    const okOrigin = allowedOrigins(env).indexOf(origin) !== -1;

    if (request.method === "OPTIONS") {
      return okOrigin ? new Response(null, { status: 204, headers: corsHeaders(origin) }) : new Response(null, { status: 403 });
    }
    if (!okOrigin) return reply(403, { error: "Origin not allowed" }, null);
    if (request.method !== "POST") return reply(405, { error: "Use POST" }, origin);

    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (path !== "/sign" && path !== "/delete") return reply(404, { error: "Not found" }, origin);

    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return reply(401, { error: "Sign in required" }, origin);

    try {
      const claims = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
      if (!claims) return reply(401, { error: "Invalid sign-in token" }, origin);
      const email = String(claims.email).toLowerCase();
      if (!(await isAdmin(token, email, env.FIREBASE_PROJECT_ID))) return reply(403, { error: "ProfAdmin access required" }, origin);

      if (path === "/sign") {
        const tokenId = crypto.randomUUID();
        const expire = Math.floor(Date.now() / 1000) + 600; // valid for 10 minutes
        const signature = await hmacSha1Hex(env.IMAGEKIT_PRIVATE_KEY, tokenId + expire);
        return reply(200, { token: tokenId, expire: expire, signature: signature, publicKey: env.IMAGEKIT_PUBLIC_KEY }, origin);
      }

      /* /delete */
      let body = {};
      try { body = await request.json(); } catch (e) { body = {}; }
      const fileId = String(body.fileId || "");
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(fileId)) return reply(400, { error: "Invalid file ID" }, origin);
      const res = await fetch("https://api.imagekit.io/v1/files/" + fileId, {
        method: "DELETE",
        headers: { Authorization: "Basic " + btoa(env.IMAGEKIT_PRIVATE_KEY + ":") }
      });
      if (res.status === 204 || res.status === 404) return reply(200, { ok: true, alreadyGone: res.status === 404 }, origin);
      return reply(502, { error: "ImageKit refused the delete (" + res.status + ")" }, origin);
    } catch (err) {
      return reply(500, { error: "Worker error" }, origin);
    }
  }
};
