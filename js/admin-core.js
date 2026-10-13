/* ─────────────────────────────────────────────────────────────────────
 * admin-core.js  (ES module, ProfAdmin console data layer)
 * All Firestore reads/writes used by pages/admin/. The real lock is the
 * Firestore Security Rules (Rules v2, extended up to v9): only accounts listed in `admins`
 * can read the student list or change status / access level / delete.
 * ───────────────────────────────────────────────────────────────────── */
import {
  collection, query, where, orderBy, limit, startAfter, getDocs, getCountFromServer,
  doc, updateDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./auth-core.js";
import * as Cat from "./catalog-core.js";

export const PAGE_SIZE = 50;
const BATCH_MAX = 400; // Firestore allows 500 writes per batch; stay below it.

/* Access levels come from the catalog (Phase 10). LEVELS is rebuilt on every
 * call so that levels added or hidden in the Catalog section show up at once. */
export function levels() {
  return Cat.allLevelIds().map((id) => ({ value: id, label: Cat.levelLabel(id), active: Cat.levelActive(id) }));
}
export const levelLabel = (v) => Cat.levelLabel(v);
export const levelsText = (list) => (list || []).map((l) => Cat.levelLabel(l)).join(", ");

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
const approveFields = (levels, adminEmail) => ({
  status: "approved",
  accessLevels: levels,
  rejectionReason: "",
  approvedAt: serverTimestamp(),
  approvedBy: adminEmail
});

export function approveOne(uid, levels, adminEmail) {
  return updateDoc(doc(db, "users", uid), approveFields(levels, adminEmail));
}

/* items: [{ uid, levels }]. Committed in batches; returns how many were saved. */
export async function approveMany(items, adminEmail) {
  let done = 0;
  for (let i = 0; i < items.length; i += BATCH_MAX) {
    const batch = writeBatch(db);
    items.slice(i, i + BATCH_MAX).forEach((it) => {
      batch.update(doc(db, "users", it.uid), approveFields(it.levels, adminEmail));
    });
    await batch.commit();
    done += Math.min(BATCH_MAX, items.length - i);
  }
  return done;
}

export function rejectOne(uid, reason) {
  return updateDoc(doc(db, "users", uid), {
    status: "rejected",
    accessLevels: [],
    rejectionReason: (reason || "").trim().slice(0, 300)
  });
}

export function setStatus(uid, status) {
  return updateDoc(doc(db, "users", uid), { status: status });
}

export function changeLevels(uid, levels) {
  return updateDoc(doc(db, "users", uid), { accessLevels: levels });
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
  /* The latest-result pointers (one per paper, id uid_paperId). */
  for (;;) {
    const snap = await getDocs(query(collection(db, "testResults"), where("uid", "==", uid), limit(BATCH_MAX)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < BATCH_MAX) break;
  }
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
