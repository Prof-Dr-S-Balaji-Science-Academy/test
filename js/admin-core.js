/* ─────────────────────────────────────────────────────────────────────
 * admin-core.js  (ES module, ProfAdmin console data layer)
 * All Firestore reads/writes used by pages/admin/. The real lock is the
 * Firestore Security Rules (Rules v2, extended up to v8): only accounts listed in `admins`
 * can read the student list or change status / access level / delete.
 * ───────────────────────────────────────────────────────────────────── */
import {
  collection, query, where, orderBy, limit, startAfter, getDocs, getCountFromServer,
  doc, updateDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, COURSES } from "./auth-core.js";

export const PAGE_SIZE = 50;
const BATCH_MAX = 400; // Firestore allows 500 writes per batch; stay below it.

/* The seven access levels with readable labels, built from the same list the
 * onboarding form uses so the two can never disagree. */
export const LEVELS = [];
COURSES.forEach((c) => c.subjects.forEach((s) => {
  LEVELS.push({ value: s.level, label: c.label + " · " + s.label });
}));
export const levelLabel = (v) => {
  const f = LEVELS.find((l) => l.value === v);
  return f ? f.label : (v || "");
};

const users = () => collection(db, "users");
const pack = (snap) => snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

/* ── Reads ── */

/* Pending applications. Equality filter only (no composite index needed);
 * pages are fetched in document-id order and sorted by date on the client. */
export async function fetchPending(cursor) {
  const parts = [where("status", "==", "pending"), limit(PAGE_SIZE)];
  if (cursor) parts.splice(1, 0, startAfter(cursor));
  const snap = await getDocs(query(users(), ...parts));
  return { rows: pack(snap), cursor: snap.docs[snap.docs.length - 1] || null, done: snap.size < PAGE_SIZE };
}

/* All students, newest first. */
export async function fetchStudents(cursor) {
  const parts = [orderBy("createdAt", "desc"), limit(PAGE_SIZE)];
  if (cursor) parts.splice(1, 0, startAfter(cursor));
  const snap = await getDocs(query(users(), ...parts));
  return { rows: pack(snap), cursor: snap.docs[snap.docs.length - 1] || null, done: snap.size < PAGE_SIZE };
}

export async function lookupByEmail(email) {
  const snap = await getDocs(query(users(), where("email", "==", email), limit(5)));
  return pack(snap);
}

export async function countPending() {
  const snap = await getCountFromServer(query(users(), where("status", "==", "pending")));
  return snap.data().count;
}

/* ── Writes ── */
const approveFields = (level, adminEmail) => ({
  status: "approved",
  accessLevel: level,
  rejectionReason: "",
  approvedAt: serverTimestamp(),
  approvedBy: adminEmail
});

export function approveOne(uid, level, adminEmail) {
  return updateDoc(doc(db, "users", uid), approveFields(level, adminEmail));
}

/* items: [{ uid, level }]. Committed in batches; returns how many were saved. */
export async function approveMany(items, adminEmail) {
  let done = 0;
  for (let i = 0; i < items.length; i += BATCH_MAX) {
    const batch = writeBatch(db);
    items.slice(i, i + BATCH_MAX).forEach((it) => {
      batch.update(doc(db, "users", it.uid), approveFields(it.level, adminEmail));
    });
    await batch.commit();
    done += Math.min(BATCH_MAX, items.length - i);
  }
  return done;
}

export function rejectOne(uid, reason) {
  return updateDoc(doc(db, "users", uid), {
    status: "rejected",
    accessLevel: "",
    rejectionReason: (reason || "").trim().slice(0, 300)
  });
}

export function setStatus(uid, status) {
  return updateDoc(doc(db, "users", uid), { status: status });
}

export function changeLevel(uid, level) {
  return updateDoc(doc(db, "users", uid), { accessLevel: level });
}

/* Deleting a student also removes their practice and mock test history
 * (L-39, L-64): every attempt record (practice and mock), every test session,
 * the answer-key lock and the progress counters. History goes first, so if it
 * fails the student record is still there and the deletion can be retried. */
async function purgeHistory(uid) {
  for (;;) {
    const snap = await getDocs(query(collection(db, "attempts"), where("uid", "==", uid), limit(BATCH_MAX)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < BATCH_MAX) break;
  }
  for (;;) {
    const snap = await getDocs(query(collection(db, "testSessions"), where("uid", "==", uid), limit(BATCH_MAX)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < BATCH_MAX) break;
  }
  await deleteDoc(doc(db, "testLocks", uid));
  await deleteDoc(doc(db, "practiceStats", uid));
}

export async function deleteOne(uid) {
  await purgeHistory(uid);
  return deleteDoc(doc(db, "users", uid));
}

export async function deleteMany(uids) {
  let done = 0;
  for (let i = 0; i < uids.length; i += BATCH_MAX) {
    const chunk = uids.slice(i, i + BATCH_MAX);
    for (const uid of chunk) await purgeHistory(uid);
    const batch = writeBatch(db);
    chunk.forEach((uid) => batch.delete(doc(db, "users", uid)));
    await batch.commit();
    done += chunk.length;
  }
  return done;
}
