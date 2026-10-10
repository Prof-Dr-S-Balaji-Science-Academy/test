/* ─────────────────────────────────────────────────────────────────────
 * analytics-core.js  (ES module, Phase 8: question-level analytics data layer)
 * Keeps Firestore reads low (Spark quota):
 *   - Attempts are read oldest-first and only the ones added since the last
 *     update are read, so each attempt costs one read in this browser, once.
 *     A small anonymous copy (no student identity) is saved in the browser
 *     (IndexedDB); nothing is read from Firestore until ProfAdmin presses Update.
 *   - Question details and answer keys are read one document at a time, only
 *     for questions that are opened, and saved in the browser the same way.
 * The real lock is Firestore Rules v8: only ProfAdmin may list attempts.
 * ───────────────────────────────────────────────────────────────────── */
import {
  collection, query, orderBy, startAfter, limit, getDocs, getDoc, doc, documentId, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./auth-core.js";
import { compactAttempt } from "./analytics-logic.js";

const DB_NAME = "pb-analytics";
const STORES = ["attempts", "questions", "keys", "meta"];
export const PAGE = 500;
export const UPDATE_CAP = 5000; // most attempts read by one press of Update

/* In-memory copy is the working set. IndexedDB only persists it between visits;
 * if it is unavailable (private window) everything still works for this visit. */
const mem = { attempts: new Map(), questions: new Map(), keys: new Map(), meta: new Map() };
let idb = null;
let ready = null;

function openIdb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return resolve(null); }
    req.onupgradeneeded = () => { STORES.forEach((s) => req.result.createObjectStore(s, { keyPath: "id" })); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function idbAll(store) {
  return new Promise((resolve) => {
    try {
      const r = idb.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
}

function idbPut(store, rows) {
  if (!idb || !rows.length) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const tx = idb.transaction(store, "readwrite");
      const os = tx.objectStore(store);
      rows.forEach((r) => os.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch (e) { resolve(); }
  });
}

function idbClear(store) {
  if (!idb) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const tx = idb.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch (e) { resolve(); }
  });
}

/* Loads the saved copy (no Firestore reads). */
export function init() {
  if (!ready) {
    ready = (async () => {
      idb = await openIdb();
      if (idb) {
        for (const s of STORES) {
          const rows = await idbAll(s);
          rows.forEach((r) => mem[s].set(r.id, r));
        }
      }
    })();
  }
  return ready;
}

/* ───────────────────────── Attempts ───────────────────────── */

export const getAttemptRows = () => Array.from(mem.attempts.values());

/* { updatedAt (ms) or 0, count } */
export function getInfo() {
  const m = mem.meta.get("attempts") || {};
  return { updatedAt: m.updatedAt || 0, count: mem.attempts.size, hasCursor: !!m.cursor };
}

/* Reads the attempts added since the last update, oldest first, in pages.
 * Stops when it has caught up or after UPDATE_CAP reads. Rows already saved
 * are never read again. onProgress(totalReadThisRun) is called after each page. */
export async function updateAttempts(onProgress) {
  await init();
  const meta = mem.meta.get("attempts") || { id: "attempts", cursor: null, updatedAt: 0 };
  let cur = meta.cursor;
  let added = 0;
  let caughtUp = false;
  while (added < UPDATE_CAP) {
    const parts = [orderBy("createdAt"), orderBy(documentId())];
    if (cur) parts.push(startAfter(new Timestamp(cur.s, cur.n), cur.id));
    const want = Math.min(PAGE, UPDATE_CAP - added);
    parts.push(limit(want));
    const snap = await getDocs(query(collection(db, "attempts"), ...parts));
    const rows = [];
    snap.docs.forEach((d) => { const r = compactAttempt(d.id, d.data()); if (r) rows.push(r); });
    rows.forEach((r) => mem.attempts.set(r.id, r));
    await idbPut("attempts", rows);
    added += snap.size;
    if (snap.size) {
      const last = snap.docs[snap.docs.length - 1];
      const t = last.data().createdAt;
      if (t && typeof t.seconds === "number") cur = { s: t.seconds, n: t.nanoseconds, id: last.id };
    }
    const next = { id: "attempts", cursor: cur, updatedAt: Date.now() };
    mem.meta.set("attempts", next);
    await idbPut("meta", [next]);
    if (onProgress) onProgress(added);
    if (snap.size < want) { caughtUp = true; break; }
  }
  return { added: added, caughtUp: caughtUp };
}

/* Throws away the saved attempts and reads everything again. Needed after
 * students are deleted: their attempts leave Firestore but stay in the copy. */
export async function rebuildAttempts(onProgress) {
  await init();
  mem.attempts.clear(); mem.meta.delete("attempts");
  await idbClear("attempts");
  await idbClear("meta");
  return updateAttempts(onProgress);
}

/* ───────────────────────── Question details and keys ───────────────────────── */

export const getQuestion = (id) => mem.questions.get(id) || null;
export const hasQuestion = (id) => mem.questions.has(id);

const QUESTION_FIELDS = ["displayId", "serial", "chapterId", "board", "cls", "subject", "type", "difficulty", "marks",
  "grouping", "status", "questionLatex", "assertionLatex", "reasonLatex", "options"];

/* Reads the questions that are not saved yet (or all, when force is true),
 * ten at a time, one read each. A question that no longer exists is saved as
 * { missing: true }. Returns how many reads were made. */
export async function loadQuestions(ids, force) {
  await init();
  const need = ids.filter((id) => force || !mem.questions.has(id));
  let reads = 0;
  for (let i = 0; i < need.length; i += 10) {
    const rows = [];
    await Promise.all(need.slice(i, i + 10).map(async (id) => {
      try {
        const s = await getDoc(doc(db, "questions", id));
        reads++;
        const rec = { id: id };
        if (s.exists()) {
          const d = s.data();
          QUESTION_FIELDS.forEach((k) => { if (d[k] !== undefined) rec[k] = d[k]; });
        } else {
          rec.missing = true;
        }
        mem.questions.set(id, rec);
        rows.push(rec);
        if (force) mem.keys.delete(id);
      } catch (e) { console.error(e); }
    }));
    await idbPut("questions", rows);
  }
  return reads;
}

/* The correct option numbers of one question (one read, then saved). */
export async function loadKey(id) {
  await init();
  if (mem.keys.has(id)) return mem.keys.get(id);
  const s = await getDoc(doc(db, "questionKeys", id));
  const rec = { id: id, correct: s.exists() && Array.isArray(s.data().correct) ? s.data().correct : [] };
  mem.keys.set(id, rec);
  await idbPut("keys", [rec]);
  return rec;
}
