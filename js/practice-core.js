/* ─────────────────────────────────────────────────────────────────────
 * practice-core.js  (ES module, student practice data layer, Phase 6)
 * Reads (all limited by Firestore Rules v6 (and, from v7, closed while a test is on) to the student's own level):
 *   taxonomy      the chapters of the student's subjects
 *   questions     published questions of one chapter (no answers)
 *   questionKeys  one answer key, fetched only after the student answers
 *   practiceStats the student's own progress counters (one document)
 * Writes: one attempts document per answered question, plus the progress
 * counters, in a single batch (saved completely or not at all).
 * Marking is done here in the browser. That is acceptable for practice,
 * where the answer is shown straight away; the raw answer is stored so the
 * result can be re-marked by ProfAdmin analytics (Phase 8).
 * ───────────────────────────────────────────────────────────────────── */
import {
  collection, query, where, limit, startAfter, getDocs, getDoc, getCountFromServer,
  doc, writeBatch, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, COURSES } from "./auth-core.js";

export const PRACTICE_PAGE = 20;

/* Board, class, label and subjects for an access level. */
export function levelInfo(level) {
  for (const c of COURSES) {
    for (const s of c.subjects) {
      if (s.level === level) return { level: level, board: c.board, cls: c.cls, label: c.label, subjects: s.list.slice() };
    }
  }
  return null;
}

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

/* ── Progress ── */
export async function fetchStats(uid) {
  const s = await getDoc(doc(db, "practiceStats", uid));
  const chapters = (s.exists() && s.data().chapters) || {};
  const totals = { answered: 0, scored: 0, correct: 0 };
  Object.keys(chapters).forEach((k) => {
    const c = chapters[k] || {};
    totals.answered += c.answered || 0;
    totals.scored += c.scored || 0;
    totals.correct += c.correct || 0;
  });
  return { chapters: chapters, totals: totals };
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

/* ── Recording an attempt ── */
export async function recordAttempt(uid, q, answer, marked, seconds, selfRight) {
  const attempt = {
    uid: uid, questionId: q.id, chapterId: q.chapterId,
    board: q.board, cls: q.cls, subject: q.subject, type: q.type, difficulty: q.difficulty,
    mode: "practice", answer: answer,
    scored: marked.scored, isCorrect: marked.isCorrect,
    timeSpent: Math.max(0, Math.min(3600, Math.round(seconds || 0))),
    createdAt: serverTimestamp()
  };
  if (marked.subResults) attempt.subResults = marked.subResults;
  if (typeof selfRight === "boolean") attempt.selfRight = selfRight;

  const batch = writeBatch(db);
  batch.set(doc(collection(db, "attempts")), attempt);
  batch.set(doc(db, "practiceStats", uid), {
    uid: uid,
    chapters: { [q.chapterId]: {
      answered: increment(1),
      scored: increment(marked.scored ? 1 : 0),
      correct: increment(marked.scored && marked.isCorrect ? 1 : 0)
    } },
    updatedAt: serverTimestamp()
  }, { merge: true });
  await batch.commit();
}
