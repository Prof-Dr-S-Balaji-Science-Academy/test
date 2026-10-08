/* ─────────────────────────────────────────────────────────────────────
 * question-core.js  (ES module, ProfAdmin question bank data layer)
 * Collections (all ProfAdmin-only under Rules v3):
 *   taxonomy/{chapterId}        one document per chapter (stable internal ID)
 *   questions/{chapterId}_{NNNN}  the question as a student may see it
 *   questionKeys/{same id}      correct answers, model answers, explanation
 * Board, class and subject folders are fixed (derived from the seven access
 * levels); only chapters are stored. Questions link to the chapter's internal
 * ID, so renaming or renumbering a chapter never orphans a question (D-19).
 * Images (Phase 4): the stem image (imageUrl, imageFileId) lives on the
 * question; the explanation image (explanationImageUrl, explanationImageFileId)
 * lives on the answer key, so it stays hidden until the answer is released.
 * Grouping (Phase 5): an optional label on the question. Questions of one
 * chapter that carry the same label are variations of each other, so an
 * auto-generated paper takes at most one of them. Groups never cross chapters.
 * ───────────────────────────────────────────────────────────────────── */
import {
  collection, query, where, limit, startAfter, getDocs, getDoc, getCountFromServer,
  doc, documentId, runTransaction, writeBatch, setDoc, updateDoc, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, COURSES } from "./auth-core.js";

export const PAGE_SIZE = 50;

/* ── Fixed folders: Board → Class → Subject ── */
export const FOLDERS = COURSES.map((c) => {
  const subjects = [];
  c.subjects.forEach((s) => s.list.forEach((n) => { if (subjects.indexOf(n) === -1) subjects.push(n); }));
  return { board: c.board, cls: c.cls, label: c.label, subjects: subjects };
});

export const BOARD_CODE = { "CBSE": "CBSE", "State Board": "SB" };
export const SUBJECT_CODE = { "Physics": "PHY", "Chemistry": "CHE", "Science": "SCI" };

/* Access levels allowed to see a question of this board / class / subject. */
export function levelsFor(board, cls, subject) {
  const out = [];
  COURSES.forEach((c) => {
    if (c.board !== board || c.cls !== cls) return;
    c.subjects.forEach((s) => { if (s.list.indexOf(subject) !== -1) out.push(s.level); });
  });
  return out;
}

/* ── Question types (D-03b). kind drives the editor and, later, marking ── */
export const TYPES = [
  { id: "mcq_single", label: "MCQ (single correct)", auto: true },
  { id: "mcq_multi", label: "MCQ (multiple correct)", auto: true },
  { id: "true_false", label: "True / False", auto: true },
  { id: "fill_blank", label: "Fill in the blank", auto: true },
  { id: "numerical", label: "Numerical", auto: true },
  { id: "assertion_reason", label: "Assertion and Reason", auto: true },
  { id: "match", label: "Match the following", auto: true },
  { id: "case_based", label: "Case-based (passage with sub-questions)", auto: true },
  { id: "very_short", label: "Very short answer", auto: false },
  { id: "short", label: "Short answer", auto: false },
  { id: "long", label: "Long answer", auto: false }
];
export const typeLabel = (id) => { const t = TYPES.find((x) => x.id === id); return t ? t.label : id; };

/* Types that can be a sub-question inside a case-based question. */
export const SUB_TYPES = ["mcq_single", "mcq_multi", "true_false", "fill_blank", "numerical", "very_short", "short"];

export const DIFFICULTIES = ["Easy", "Medium", "Hard"];

/* The four standard Assertion and Reason options (editable in the form). */
export const AR_OPTIONS = [
  "Both A and R are true and R is the correct explanation of A.",
  "Both A and R are true but R is not the correct explanation of A.",
  "A is true but R is false.",
  "A is false but R is true."
];

/* Image fields (and the optional Grouping label): null or empty means "not
 * set". On create they are left out; on edit they are removed from the
 * stored document. */
const IMAGE_FIELDS = ["imageUrl", "imageFileId", "grouping"];
function forCreate(fields) {
  const out = { ...fields };
  IMAGE_FIELDS.forEach((k) => { if (out[k] == null || out[k] === "") delete out[k]; });
  return out;
}
function forUpdate(fields) {
  const out = { ...fields };
  IMAGE_FIELDS.forEach((k) => { if (k in out && (out[k] == null || out[k] === "")) out[k] = deleteField(); });
  return out;
}
function cleanKeys(keys) {
  const out = { ...keys };
  ["explanationImageUrl", "explanationImageFileId"].forEach((k) => { if (out[k] == null) delete out[k]; });
  return out;
}

const pad = (n, w) => String(n).padStart(w, "0");
const chapters = () => collection(db, "taxonomy");
const questions = () => collection(db, "questions");

/* ── Chapters ── */
export async function fetchChapters(board, cls, subject) {
  const snap = await getDocs(query(chapters(),
    where("board", "==", board), where("cls", "==", cls), where("subject", "==", subject)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (a.chapterNumber - b.chapterNumber) || String(a.chapterName).localeCompare(String(b.chapterName)));
  return rows;
}

/* Questions of a chapter are stored with IDs that start with the chapter ID,
 * so one ID-range query lists them in serial order with no extra index. */
function chapterRange(chapterId) {
  return [where(documentId(), ">=", chapterId + "_"), where(documentId(), "<", chapterId + "_\uf8ff")];
}

export async function countQuestions(chapterId) {
  const snap = await getCountFromServer(query(questions(), ...chapterRange(chapterId)));
  return snap.data().count;
}

export async function createChapter(ctx, f) {
  const ref = doc(chapters());
  await setDoc(ref, {
    board: ctx.board, cls: ctx.cls, subject: ctx.subject,
    chapterNumber: f.number, chapterName: f.name, edition: f.edition || "",
    nextSerial: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return ref.id;
}

export function updateChapter(id, f) {
  return updateDoc(doc(db, "taxonomy", id), {
    chapterNumber: f.number, chapterName: f.name, edition: f.edition || "", updatedAt: serverTimestamp()
  });
}

/* A chapter that still has questions cannot be deleted. */
export async function deleteChapter(id) {
  const n = await countQuestions(id);
  if (n > 0) return { ok: false, count: n };
  const batch = writeBatch(db);
  batch.delete(doc(db, "taxonomy", id));
  await batch.commit();
  return { ok: true, count: 0 };
}

/* ── Questions ── */
export async function fetchQuestions(chapterId, cursor) {
  const parts = [...chapterRange(chapterId), limit(PAGE_SIZE)];
  if (cursor) parts.splice(2, 0, startAfter(cursor));
  const snap = await getDocs(query(questions(), ...parts));
  return {
    rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: snap.docs[snap.docs.length - 1] || null,
    done: snap.size < PAGE_SIZE
  };
}

export async function getKey(id) {
  const s = await getDoc(doc(db, "questionKeys", id));
  return s.exists() ? s.data() : {};
}

/* New question. Serial numbers come from a counter on the chapter, read and
 * advanced inside one transaction, so two questions never share a number. */
export async function createQuestion(chapter, adminEmail, fields, keys) {
  const chRef = doc(db, "taxonomy", chapter.id);
  return runTransaction(db, async (tx) => {
    const cs = await tx.get(chRef);
    if (!cs.exists()) throw new Error("Chapter no longer exists");
    const c = cs.data();
    const serial = c.nextSerial || 1;
    const id = chapter.id + "_" + pad(serial, 4);
    const displayId = BOARD_CODE[c.board] + c.cls + "-" + SUBJECT_CODE[c.subject] + "-C" + pad(c.chapterNumber, 2) + "-" + pad(serial, 4);
    tx.set(doc(db, "questions", id), {
      ...forCreate(fields),
      displayId: displayId, serial: serial, chapterId: chapter.id,
      board: c.board, cls: c.cls, subject: c.subject,
      levels: levelsFor(c.board, c.cls, c.subject),
      createdBy: adminEmail, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    tx.set(doc(db, "questionKeys", id), cleanKeys(keys));
    tx.update(chRef, { nextSerial: serial + 1, updatedAt: serverTimestamp() });
    return { id: id, displayId: displayId, serial: serial };
  });
}

/* Edit: only the editable fields are written; the ID, chapter, type, levels
 * and creator are never touched. The answer key is replaced as a whole. */
export async function saveQuestion(existing, fields, keys) {
  const batch = writeBatch(db);
  batch.update(doc(db, "questions", existing.id), { ...forUpdate(fields), updatedAt: serverTimestamp() });
  batch.set(doc(db, "questionKeys", existing.id), cleanKeys(keys));
  await batch.commit();
}

export function setQuestionStatus(id, status) {
  return updateDoc(doc(db, "questions", id), { status: status, updatedAt: serverTimestamp() });
}

/* Permanent deletion of the question and its answer key. */
export async function deleteQuestion(id) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "questions", id));
  batch.delete(doc(db, "questionKeys", id));
  await batch.commit();
}

/* ── Bulk import (Phase 5) ── */

/* Every question of one chapter (used to find duplicates before an import).
 * Reads one document per question, so it is called only for the chapters an
 * uploaded file actually refers to. */
export async function fetchAllQuestions(chapterId) {
  const out = [];
  let cursor = null;
  for (;;) {
    const parts = [...chapterRange(chapterId), limit(500)];
    if (cursor) parts.splice(2, 0, startAfter(cursor));
    const snap = await getDocs(query(questions(), ...parts));
    snap.docs.forEach((d) => out.push({ id: d.id, ...d.data() }));
    if (snap.size < 500) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out;
}

/* Saves several new questions of ONE chapter (at most 50 per call). The serial
 * numbers are reserved in one transaction on the chapter counter, then the
 * questions and their answer keys are written in one batch, so the batch is
 * saved completely or not at all. entries: [{ fields, keys }]. */
export async function createQuestionsBulk(chapterId, adminEmail, entries) {
  if (!entries.length) return [];
  if (entries.length > 50) throw new Error("At most 50 questions can be saved in one step.");
  const chRef = doc(db, "taxonomy", chapterId);
  const base = await runTransaction(db, async (tx) => {
    const cs = await tx.get(chRef);
    if (!cs.exists()) throw new Error("Chapter no longer exists");
    const c = cs.data();
    const first = c.nextSerial || 1;
    tx.update(chRef, { nextSerial: first + entries.length, updatedAt: serverTimestamp() });
    return { first: first, c: c };
  });
  const c = base.c;
  const levels = levelsFor(c.board, c.cls, c.subject);
  const batch = writeBatch(db);
  const out = [];
  entries.forEach((e, i) => {
    const serial = base.first + i;
    const id = chapterId + "_" + pad(serial, 4);
    const displayId = BOARD_CODE[c.board] + c.cls + "-" + SUBJECT_CODE[c.subject] + "-C" + pad(c.chapterNumber, 2) + "-" + pad(serial, 4);
    batch.set(doc(db, "questions", id), {
      ...forCreate(e.fields),
      displayId: displayId, serial: serial, chapterId: chapterId,
      board: c.board, cls: c.cls, subject: c.subject, levels: levels,
      createdBy: adminEmail, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    batch.set(doc(db, "questionKeys", id), cleanKeys(e.keys));
    out.push({ id: id, displayId: displayId, serial: serial });
  });
  await batch.commit();
  return out;
}
