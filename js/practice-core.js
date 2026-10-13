/* ─────────────────────────────────────────────────────────────────────
 * practice-core.js  (ES module, student practice data layer)
 * Practice is NOT saved (owner decision, Rules v10). Nothing here writes to
 * Firestore: a practice session lives in the page and is gone when the student
 * leaves it. Reads (all limited by Firestore Rules v10 (and closed while a test is on) to the student's own level):
 *   taxonomy      the chapters of the student's subjects
 *   questions     published questions of one chapter (no answers)
 *   questionKeys  the answer keys, fetched only when the student finishes
 * Marking is done here in the browser, which is acceptable for practice,
 * where the answers are shown at the end.
 * ───────────────────────────────────────────────────────────────────── */
import {
  collection, query, where, limit, startAfter, getDocs, getDoc, getCountFromServer, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./auth-core.js";
import { levelInfo } from "./catalog-core.js";

export const PRACTICE_PAGE = 20;
/* The most questions one practice session holds. */
export const PRACTICE_MAX = 50;

/* Board, class, label and subject of an access level (from the catalog). */
export { levelInfo };

/* ── Chapters and counts ── */
export async function fetchChapters(info, subject) {
  const snap = await getDocs(query(collection(db, "taxonomy"),
    where("board", "==", info.board), where("cls", "==", info.cls), where("subject", "==", subject)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (a.chapterNumber - b.chapterNumber) || String(a.chapterName).localeCompare(String(b.chapterName)));
  return rows;
}

function questionQuery(level, chapterId, filters) {
  const parts = [
    where("chapterId", "==", chapterId),
    where("status", "==", "published"),
    where("levels", "array-contains", level)
  ];
  if (filters && filters.difficulty) parts.push(where("difficulty", "==", filters.difficulty));
  if (filters && filters.type) parts.push(where("type", "==", filters.type));
  return parts;
}

export async function countPublished(level, chapterId, filters) {
  const snap = await getCountFromServer(query(collection(db, "questions"), ...questionQuery(level, chapterId, filters)));
  return snap.data().count;
}

/* Published questions of one chapter in question-number order (document IDs
 * start with the chapter ID and end with the serial). */
export async function fetchPracticeQuestions(level, chapterId, filters, cursor) {
  const parts = [...questionQuery(level, chapterId, filters), limit(PRACTICE_PAGE)];
  if (cursor) parts.splice(parts.length - 1, 0, startAfter(cursor));
  const snap = await getDocs(query(collection(db, "questions"), ...parts));
  return {
    rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: snap.docs[snap.docs.length - 1] || null,
    done: snap.size < PRACTICE_PAGE
  };
}

export async function fetchKey(id) {
  const s = await getDoc(doc(db, "questionKeys", id));
  return s.exists() ? s.data() : {};
}

/* All matching questions of a chapter for one practice session, in question-number
 * order, up to PRACTICE_MAX. Returns { rows, total } (total = how many match). */
export async function fetchSessionQuestions(level, chapterId, filters) {
  const total = await countPublished(level, chapterId, filters);
  let rows = [], cursor = null, done = false;
  while (!done && rows.length < PRACTICE_MAX) {
    const page = await fetchPracticeQuestions(level, chapterId, filters, cursor);
    rows = rows.concat(page.rows);
    cursor = page.cursor; done = page.done;
  }
  return { rows: rows.slice(0, PRACTICE_MAX), total: total };
}

/* The answer keys of a finished practice session. denied is true when the server
 * refuses (a mock test is in progress); the keys are then incomplete. */
export async function fetchKeys(ids) {
  const keys = {};
  let denied = false;
  for (let i = 0; i < ids.length; i += 6) {
    await Promise.all(ids.slice(i, i + 6).map(async (id) => {
      try { keys[id] = await fetchKey(id); }
      catch (err) {
        if (err && err.code === "permission-denied") denied = true; else throw err;
        keys[id] = {};
      }
    }));
  }
  return { keys: keys, denied: denied };
}

/* ── Marking ── */
export const WRITTEN = ["very_short", "short", "long"];
export const isWritten = (type) => WRITTEN.indexOf(type) !== -1;

const normText = (t) => String(t == null ? "" : t).trim().toLowerCase().replace(/\s+/g, " ");

function sameSet(a, b) {
  const x = Array.from(new Set(a)).sort(), y = Array.from(new Set(b)).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/* One part (a whole question, or one sub-question). item: the question or
 * sub-question data; key: its answer key; ans: { sel, text }.
 * Returns true / false, or null for written types (not auto-marked). */
export function markPart(type, item, key, ans) {
  key = key || {}; ans = ans || {};
  if (isWritten(type)) return null;
  if (type === "mcq_single" || type === "true_false" || type === "assertion_reason") {
    return !!(ans.sel && ans.sel.length === 1 && key.correct && key.correct.indexOf(ans.sel[0]) !== -1);
  }
  if (type === "mcq_multi") return !!(ans.sel && ans.sel.length && key.correct && sameSet(ans.sel, key.correct));
  if (type === "fill_blank") {
    const a = normText(ans.text);
    return !!a && (key.acceptedAnswers || []).some((x) => normText(x) === a);
  }
  if (type === "numerical") {
    const v = parseFloat(String(ans.text == null ? "" : ans.text).trim());
    if (!isFinite(v) || typeof key.numericAnswer !== "number") return false;
    const tol = (typeof key.tolerance === "number" && key.tolerance > 0) ? key.tolerance : 0;
    return Math.abs(v - key.numericAnswer) <= tol + 1e-9;
  }
  if (type === "match") {
    const n = (item.matchLeft || []).length;
    if (!ans.sel || ans.sel.length !== n || !key.matchMap) return false;
    return ans.sel.every((v, i) => v === key.matchMap[i]);
  }
  return false;
}

/* Whole question. answer: { sel, text } or, for case-based, { subs: [...] }.
 * Returns { scored, isCorrect, subResults? }. A question counts as scored
 * when at least one part can be auto-marked; it is correct only when every
 * auto-marked part is correct. */
export function markQuestion(q, key, answer) {
  key = key || {};
  if (q.type === "case_based") {
    const subs = q.subQuestions || [];
    const results = subs.map((s, i) => markPart(s.type, s, (key.subKeys || [])[i], (answer.subs || [])[i]));
    const auto = results.filter((r) => r !== null);
    return {
      scored: auto.length > 0,
      isCorrect: auto.length > 0 && auto.every((r) => r === true),
      subResults: results
    };
  }
  const r = markPart(q.type, q, key, answer);
  return { scored: r !== null, isCorrect: r === true };
}
