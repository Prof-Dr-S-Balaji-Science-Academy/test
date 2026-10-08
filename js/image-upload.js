/* ─────────────────────────────────────────────────────────────────────
 * image-upload.js  (ES module, ProfAdmin question images, Phase 4)
 * - checks and shrinks an image in the browser (JPG / PNG / WebP, 2 MB)
 * - asks the Cloudflare Worker for a short-lived upload signature
 * - uploads straight to ImageKit; asks the Worker to delete old images
 * The ImageKit private key is never here; it lives only in the Worker.
 * ───────────────────────────────────────────────────────────────────── */
import { auth } from "./auth-core.js";

export const WORKER_URL = "https://imagekit-auth.cbsedigest.workers.dev";
const UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";

export const MAX_BYTES = 2 * 1024 * 1024;
export const ACCEPT = "image/jpeg,image/png,image/webp";
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIDE = 1600;

/* ── Check and shrink ── */
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This file could not be read as an image.")); };
    img.src = url;
  });
}
function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/* Returns { blob, shrunk }. Throws an Error with a plain message. */
export async function prepareImage(file) {
  if (!file || TYPES.indexOf(file.type) === -1) throw new Error("Only JPG, PNG or WebP images are allowed.");
  if (file.size <= MAX_BYTES) return { blob: file, shrunk: false };

  const img = await loadImage(file);
  let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  let quality = 0.85;
  for (let attempt = 0; attempt < 8; attempt++) {
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    /* White behind the picture, so transparent areas do not turn black in JPEG. */
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let blob = await toBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality); // browsers that cannot write WebP
    if (blob && blob.size <= MAX_BYTES) return { blob: blob, shrunk: true };
    quality = Math.max(0.5, quality - 0.1);
    scale *= 0.85;
  }
  throw new Error("This image is too large to shrink under 2 MB. Please crop it or use a smaller one.");
}

/* ── Worker calls ── */
async function idToken() {
  const u = auth.currentUser;
  if (!u) throw new Error("Please sign in again.");
  return u.getIdToken();
}

async function workerPost(path, body) {
  const res = await fetch(WORKER_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (await idToken()) },
    body: JSON.stringify(body || {})
  });
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) {
    const err = new Error(data.error || ("Image service error (" + res.status + ")"));
    err.status = res.status;
    throw err;
  }
  return data;
}

function extFor(blob) {
  return blob.type === "image/png" ? ".png" : blob.type === "image/webp" ? ".webp" : ".jpg";
}

/* Uploads one image. folder looks like /questions/cbse/12/physics/chapter-3 */
export async function uploadImage(blob, folder, baseName) {
  const sig = await workerPost("/sign", {});
  const form = new FormData();
  form.append("file", blob);
  form.append("fileName", baseName + extFor(blob));
  form.append("publicKey", sig.publicKey);
  form.append("signature", sig.signature);
  form.append("expire", String(sig.expire));
  form.append("token", sig.token);
  form.append("folder", folder);
  form.append("useUniqueFileName", "true");
  const res = await fetch(UPLOAD_URL, { method: "POST", body: form });
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok || !data.url || !data.fileId) throw new Error(data.message || ("Image upload failed (" + res.status + ")"));
  return { url: data.url, fileId: data.fileId };
}

export function deleteImage(fileId) {
  return workerPost("/delete", { fileId: fileId });
}

/* Delete several; never throws. Returns how many could not be deleted. */
export async function deleteImages(fileIds) {
  let failed = 0;
  for (const id of fileIds) {
    if (!id) continue;
    try { await deleteImage(id); } catch (e) { console.error(e); failed += 1; }
  }
  return failed;
}

/* ImageKit delivery URL with a width limit (ImageKit also picks the best format). */
export function displayUrl(url, width) {
  if (!url) return "";
  return url.split("?")[0] + "?tr=w-" + (width || 900);
}

/* Folder for a chapter, e.g. /questions/cbse/12/physics/chapter-3 */
export function folderFor(chapter) {
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return "/questions/" + slug(chapter.board) + "/" + slug(chapter.cls) + "/" + slug(chapter.subject) + "/chapter-" + chapter.chapterNumber;
}
