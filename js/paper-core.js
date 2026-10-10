/* ─────────────────────────────────────────────────────────────────────
 * paper-core.js  (ES module, Phase 7: papers and mock tests data layer)
 * Collections (see firebase/firestore.rules, Rules v8):
 *   papers/{id}         paper definitions, written by ProfAdmin only
 *   testSessions/{id}   one per student attempt of a paper. The start time is
 *                       recorded by the server; the deadline is the start time
 *                       plus the duration, worked out by the rules and by the
 *                       timer from that server time, never from the device clock.
 *   testLocks/{uid}     one per student. While it is active the student cannot
 *                       read any answer key (closes risk R-08).
 *   attempts/{id}       one record per answered, auto-marked question, written
 *                       after submission (mode "mock", Phase 8 feeds on these).
 * Nothing here is trusted by the server beyond what the rules check. The score
 * is never stored by the browser: it is worked out from the saved answers and
 * the released keys whenever a result is shown.
 * ───────────────────────────────────────────────────────────────────── */
import {
  collection, query, where, orderBy, limit, getDocs, getDoc, getDocFromServer, getCountFromServer,
  doc, updateDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./auth-core.js";
import { GRACE_SECONDS, MAX_QUESTIONS } from "./paper-logic.js";

const papers = () => collection(db, "papers");
const sessions = () => collection(db, "testSessions");
const packDoc = (d) => ({ id: d.id, ...d.data() });

/* ───────────────────────── ProfAdmin: papers ───────────────────────── */

export async function listPapers() {
  const snap = await getDocs(query(papers(), orderBy("createdAt", "desc"), limit(100)));
  return snap.docs.map(packDoc);
}

export async function createPaper(adminEmail, fields) {
  const ref = doc(papers());
  const batch = writeBatch(db);
  batch.set(ref, { ...fields, createdBy: adminEmail, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await batch.commit();
  return ref.id;
}

/* Board, class, subject and mode never change after creation. */
export function updatePaper(id, fields) {
  return updateDoc(doc(db, "papers", id), { ...fields, updatedAt: serverTimestamp() });
}

export function setPaperStatus(id, status) {
  return updateDoc(doc(db, "papers", id), { status: status, updatedAt: serverTimestamp() });
}

export function setPaperAccess(id, access) {
  return updateDoc(doc(db, "papers", id), { access: access, updatedAt: serverTimestamp() });
}

export function deletePaper(id) {
  return deleteDoc(doc(db, "papers", id));
}

/* Basic facts of the questions of a fixed paper (one read each). A missing
 * question comes back as null. */
export async function fetchQuestionMeta(ids) {
  const out = await Promise.all(ids.map(async (id) => {
    try {
      const s = await getDoc(doc(db, "questions", id));
      return s.exists() ? { id: id, ...s.data() } : null;
    } catch (e) { console.error(e); return null; }
  }));
  return out;
}

/* How many published questions match the rules, per difficulty. One count
 * query per chapter, difficulty and chosen type (equality filters only).
 * Grouping can lower the real number; this is an upper bound. */
export async function poolCounts(chapterIds, types) {
  const jobs = [];
  chapterIds.forEach((c) => ["Easy", "Medium", "Hard"].forEach((d) => types.forEach((t) => jobs.push({ c: c, d: d, t: t }))));
  if (jobs.length > 150) throw new Error("TOO_MANY");
  const totals = { Easy: 0, Medium: 0, Hard: 0 };
  for (let i = 0; i < jobs.length; i += 15) {
    await Promise.all(jobs.slice(i, i + 15).map(async (j) => {
      const snap = await getCountFromServer(query(collection(db, "questions"),
        where("chapterId", "==", j.c), where("status", "==", "published"),
        where("difficulty", "==", j.d), where("type", "==", j.t)));
      totals[j.d] += snap.data().count;
    }));
  }
  return totals;
}

/* ───────────────────────── Student: papers and sessions ───────────────────────── */

/* Published papers of the student's own level (public and locked). */
export async function fetchPapersForLevel(level) {
  const snap = await getDocs(query(papers(), where("status", "==", "published"), where("levels", "array-contains", level)));
  const rows = snap.docs.map(packDoc);
  rows.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return rows;
}

export async function fetchPaperLive(id) {
  try {
    const s = await getDoc(doc(db, "papers", id));
    return s.exists() ? packDoc(s) : null;
  } catch (e) { return null; }
}

export async function fetchActiveSessions(uid) {
  const snap = await getDocs(query(sessions(), where("uid", "==", uid), where("status", "==", "in_progress"), limit(5)));
  return snap.docs.map(packDoc);
}

export async function fetchSubmittedSessions(uid) {
  const snap = await getDocs(query(sessions(), where("uid", "==", uid), where("status", "==", "submitted"), limit(100)));
  const rows = snap.docs.map(packDoc);
  const t = (r) => (r.startedAt && r.startedAt.toMillis ? r.startedAt.toMillis() : 0);
  rows.sort((a, b) => t(b) - t(a));
  return rows;
}

/* Questions by ID. A question the student cannot read (unpublished, removed)
 * comes back as null. */
export async function loadQuestions(ids) {
  const map = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const s = await getDoc(doc(db, "questions", id));
      map[id] = s.exists() ? { id: id, ...s.data() } : null;
    } catch (e) { console.error(e); map[id] = null; }
  }));
  return map;
}

/* All published questions the student may use in the chapters of a
 * rule-based paper, for the difficulties the rules ask for. Types are
 * filtered here so only equality filters reach the database. */
export async function loadRulePool(level, rules) {
  const diffs = ["Easy", "Medium", "Hard"].filter((d) => (rules.mix[d] || 0) > 0);
  const out = [];
  const jobs = [];
  rules.chapterIds.forEach((c) => diffs.forEach((d) => jobs.push({ c: c, d: d })));
  for (let i = 0; i < jobs.length; i += 6) {
    const parts = await Promise.all(jobs.slice(i, i + 6).map((j) => getDocs(query(collection(db, "questions"),
      where("chapterId", "==", j.c), where("status", "==", "published"),
      where("levels", "array-contains", level), where("difficulty", "==", j.d)))));
    parts.forEach((snap) => snap.docs.forEach((d) => {
      const q = packDoc(d);
      if (rules.types.indexOf(q.type) !== -1) out.push(q);
    }));
  }
  return out;
}

/* Starts a test: the session and the answer-key lock are written together,
 * so either both exist or neither does. Returns the stored session. */
export async function startSession(uid, paper, level, order, optionOrder) {
  const ref = doc(sessions());
  const batch = writeBatch(db);
  batch.set(ref, {
    uid: uid, paperId: paper.id, paperTitle: paper.title,
    board: paper.board, cls: paper.cls, subject: paper.subject, level: level,
    questionIds: order, optionOrder: optionOrder,
    durationMin: paper.durationMin, negativeMarking: paper.negativeMarking,
    startedAt: serverTimestamp(), status: "in_progress", answers: {}, marked: []
  });
  batch.set(doc(db, "testLocks", uid), { sessionId: ref.id, active: true, updatedAt: serverTimestamp() });
  await batch.commit();
  const s = await getDocFromServer(ref);
  return packDoc(s);
}

export async function fetchSession(id) {
  const s = await getDocFromServer(doc(db, "testSessions", id));
  return s.exists() ? packDoc(s) : null;
}

/* The moment the test ends, in milliseconds since 1970 (server time). */
export function deadlineMs(session) {
  return session.startedAt.toMillis() + session.durationMin * 60000;
}
export const graceMs = () => GRACE_SECONDS * 1000;

/* Saves the answers so far. Returns the server time at the moment of saving
 * (milliseconds), which the timer uses to correct for the device clock; null
 * when the server refuses (the grace period after the deadline is over). */
export async function saveProgress(sessionId, answers, marked) {
  const ref = doc(db, "testSessions", sessionId);
  try {
    await updateDoc(ref, { answers: answers, marked: marked, savedAt: serverTimestamp() });
  } catch (err) {
    if (err && err.code === "permission-denied") return null;
    throw err;
  }
  const s = await getDocFromServer(ref);
  const t = s.data().savedAt;
  return t && t.toMillis ? t.toMillis() : null;
}

/* Submits the test and opens the answer keys (the lock is released in the same
 * batch). The server decides whether the submission is late. A late submission
 * is accepted but keeps the answers saved last (the rules freeze them), so if
 * the first try is refused it is tried again that way. */
export async function submitSession(session, answers, marked, probablyLate) {
  const ref = doc(db, "testSessions", session.id);
  const lockRef = doc(db, "testLocks", session.uid);
  async function attempt(late) {
    const batch = writeBatch(db);
    const fields = { status: "submitted", submittedAt: serverTimestamp(), late: late };
    if (!late) { fields.answers = answers; fields.marked = marked; }
    batch.update(ref, fields);
    batch.update(lockRef, { active: false, updatedAt: serverTimestamp() });
    await batch.commit();
  }
  try {
    await attempt(!!probablyLate);
  } catch (err) {
    if (!err || err.code !== "permission-denied") throw err;
    await attempt(!probablyLate);
  }
  return fetchSession(session.id);
}

/* Answer keys, once the test is submitted. Returns { keys, denied } where
 * denied is true if the server still refuses (test not submitted). */
export async function loadKeys(ids) {
  const keys = {};
  let denied = false;
  await Promise.all(ids.map(async (id) => {
    try {
      const s = await getDoc(doc(db, "questionKeys", id));
      keys[id] = s.exists() ? s.data() : {};
    } catch (err) {
      if (err && err.code === "permission-denied") denied = true; else console.error(err);
      keys[id] = {};
    }
  }));
  return { keys: keys, denied: denied };
}

/* One attempt record per answered, auto-marked question. The document ID is
 * sessionId_questionId, so a record can never be written twice. Best effort:
 * the saved session already holds every answer. */
export async function recordMockAttempts(uid, session, qs, answers, correctMap) {
  const rows = [];
  session.questionIds.forEach((id) => {
    const q = qs[id], a = answers[id];
    if (!q || !a || !a.sel || !a.sel.length || !(id in correctMap)) return;
    rows.push({ id: id, q: q, a: a, ok: correctMap[id] });
  });
  for (let i = 0; i < rows.length; i += 200) {
    const batch = writeBatch(db);
    rows.slice(i, i + 200).forEach((r) => {
      batch.set(doc(db, "attempts", session.id + "_" + r.id), {
        uid: uid, sessionId: session.id, paperId: session.paperId, questionId: r.id, chapterId: r.q.chapterId,
        board: r.q.board, cls: r.q.cls, subject: r.q.subject, type: r.q.type, difficulty: r.q.difficulty,
        mode: "mock", answer: { sel: r.a.sel }, scored: true, isCorrect: r.ok, timeSpent: 0,
        createdAt: serverTimestamp()
      });
    });
    await batch.commit();
  }
}

export { MAX_QUESTIONS };
