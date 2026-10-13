/* ─────────────────────────────────────────────────────────────────────
 * catalog-core.js  (ES module, Phase 10)
 * The catalog is ONE Firestore document, catalog/main, that lists every
 * board, class, subject and access level of the test platform. It replaces
 * the lists that used to be fixed in the code.
 *
 *   boards    { <boardId>: { name, code, order } }
 *   classes   { "<boardId>|<classId>": { board, id, name, code, order } }
 *   subjects  { "<boardId>|<classId>|<subjectId>": { board, cls, id, name, code, order } }
 *   levels    { <levelId>: { board, cls, subject, active } }
 *   activeLevelIds / allLevelIds   lists kept in step with `levels`
 *                                  (Security Rules cannot loop over a map)
 *
 * Every subject has exactly one access level (a student level is one board,
 * one class and one subject). A level is created together with its subject
 * and stays hidden from the sign-up form until ProfAdmin switches it on.
 * Questions, chapters and papers store the stable IDs, so renaming a board,
 * class or subject only changes the name that is shown.
 *
 * Everyone who is signed in may read the catalog; only ProfAdmin may change it.
 * ───────────────────────────────────────────────────────────────────── */
import {
  collection, query, where, limit, startAfter, getDocs, doc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./auth-core.js";

export const MAX_STUDENT_LEVELS = 8;

/* The platform as it was before Phase 10. Used once, to create the catalog. */
const SEED = {
  boards: {
    "CBSE": { name: "CBSE", code: "CBSE", order: 1 },
    "State Board": { name: "State Board", code: "SB", order: 2 }
  },
  classes: {
    "CBSE|10": { board: "CBSE", id: "10", name: "Class 10", code: "10", order: 1 },
    "CBSE|12": { board: "CBSE", id: "12", name: "Class 12", code: "12", order: 2 },
    "State Board|12": { board: "State Board", id: "12", name: "Class 12", code: "12", order: 1 }
  },
  subjects: {
    "CBSE|10|Science": { board: "CBSE", cls: "10", id: "Science", name: "Science", code: "SCI", order: 1 },
    "CBSE|12|Physics": { board: "CBSE", cls: "12", id: "Physics", name: "Physics", code: "PHY", order: 1 },
    "CBSE|12|Chemistry": { board: "CBSE", cls: "12", id: "Chemistry", name: "Chemistry", code: "CHE", order: 2 },
    "State Board|12|Physics": { board: "State Board", cls: "12", id: "Physics", name: "Physics", code: "PHY", order: 1 },
    "State Board|12|Chemistry": { board: "State Board", cls: "12", id: "Chemistry", name: "Chemistry", code: "CHE", order: 2 }
  },
  levels: {
    "C10SciStudents": { board: "CBSE", cls: "10", subject: "Science", active: true },
    "C12PhyStudents": { board: "CBSE", cls: "12", subject: "Physics", active: true },
    "C12ChemStudents": { board: "CBSE", cls: "12", subject: "Chemistry", active: true },
    "S12PhyStudents": { board: "State Board", cls: "12", subject: "Physics", active: true },
    "S12ChemStudents": { board: "State Board", cls: "12", subject: "Chemistry", active: true }
  }
};

/* The two combined levels of the old design. A student who held one now holds
 * the two single-subject levels instead. */
export const LEGACY_SPLIT = {
  "C12PhyChemStudents": ["C12PhyStudents", "C12ChemStudents"],
  "S12PhyChemStudents": ["S12PhyStudents", "S12ChemStudents"]
};
export function expandLegacy(list) {
  const out = [];
  (list || []).forEach((l) => {
    (LEGACY_SPLIT[l] || [l]).forEach((x) => { if (x && out.indexOf(x) === -1) out.push(x); });
  });
  return out;
}

const catRef = () => doc(db, "catalog", "main");
let CAT = null;

function finalize(c) {
  c.allLevelIds = Object.keys(c.levels);
  c.activeLevelIds = c.allLevelIds.filter((id) => c.levels[id].active === true);
  return c;
}
function emptyCatalog() {
  return finalize({ boards: {}, classes: {}, subjects: {}, levels: {}, missing: true });
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function pickCatalog(d) {
  return finalize({
    boards: d.boards || {}, classes: d.classes || {}, subjects: d.subjects || {}, levels: d.levels || {}
  });
}

/* Loads the catalog (one read) and keeps it in memory for this page.
 * opts.seed (ProfAdmin only): create it from the old fixed lists when it does
 * not exist yet. opts.force: read again. */
export async function loadCatalog(opts) {
  opts = opts || {};
  if (CAT && !opts.force) return CAT;
  let snap = null;
  try { snap = await getDoc(catRef()); } catch (e) { if (!opts.seed) throw e; }
  if (snap && snap.exists()) { CAT = pickCatalog(snap.data()); return CAT; }
  if (opts.seed) {
    const seed = finalize(clone(SEED));
    await setDoc(catRef(), {
      boards: seed.boards, classes: seed.classes, subjects: seed.subjects, levels: seed.levels,
      activeLevelIds: seed.activeLevelIds, allLevelIds: seed.allLevelIds, updatedAt: serverTimestamp()
    });
    CAT = seed;
    return CAT;
  }
  CAT = emptyCatalog();
  return CAT;
}

export function catalogReady() { return !!CAT; }
function C() { return CAT || emptyCatalog(); }

const k2 = (b, c) => b + "|" + c;
const k3 = (b, c, s) => b + "|" + c + "|" + s;
const byOrder = (a, b) => ((a.order || 0) - (b.order || 0)) || String(a.name).localeCompare(String(b.name));

/* ── Names and codes ── */
export const boardName = (b) => (C().boards[b] || {}).name || b;
export const className = (b, c) => (C().classes[k2(b, c)] || {}).name || ("Class " + c);
export const subjectName = (b, c, s) => (C().subjects[k3(b, c, s)] || {}).name || s;
export const courseLabel = (b, c) => boardName(b) + " " + className(b, c);
export const scopeLabel = (b, c, s) => courseLabel(b, c) + " \u00b7 " + subjectName(b, c, s);
export const boardCode = (b) => (C().boards[b] || {}).code || String(b).toUpperCase();
export const classCode = (b, c) => (C().classes[k2(b, c)] || {}).code || String(c);
export const subjectCode = (b, c, s) => (C().subjects[k3(b, c, s)] || {}).code || String(s).slice(0, 3).toUpperCase();
/* e.g. CBSE12-PHY (the front of a question's readable ID). */
export const idPrefix = (b, c, s) => boardCode(b) + classCode(b, c) + "-" + subjectCode(b, c, s);

/* ── Lists (sorted) ── */
export function boardList() {
  return Object.keys(C().boards).map((id) => ({ id: id, ...C().boards[id] })).sort(byOrder);
}
export function classList(board) {
  return Object.keys(C().classes).map((k) => C().classes[k]).filter((x) => x.board === board).sort(byOrder);
}
export function subjectList(board, cls) {
  return Object.keys(C().subjects).map((k) => C().subjects[k]).filter((x) => x.board === board && x.cls === cls).sort(byOrder);
}
export function subjectExists(b, c, s) { return !!C().subjects[k3(b, c, s)]; }

/* Board, class and its subjects, in display order (used by the folder screens,
 * the bulk upload and the paper and analytics pickers). */
export function folders() {
  const out = [];
  boardList().forEach((b) => classList(b.id).forEach((c) => {
    out.push({
      board: b.id, cls: c.id, label: courseLabel(b.id, c.id),
      subjects: subjectList(b.id, c.id).map((s) => s.id)
    });
  }));
  return out;
}

/* Turns the Board, Class and Subject cells of a bulk-upload row into catalog IDs.
 * A cell may hold the name, the ID or the short code (for a class, a bare number
 * such as 12 also matches "Class 12"). Returns { board, cls, subject, errs[] }. */
export function resolveScope(boardText, clsText, subjectText) {
  const n = (t) => String(t == null ? "" : t).replace(/\.0+$/, "").replace(/\s+/g, " ").trim().toLowerCase();
  const out = { board: "", cls: "", subject: "", errs: [] };
  const b = boardList().find((x) => n(x.name) === n(boardText) || n(x.id) === n(boardText) || n(x.code) === n(boardText));
  if (!b) { out.errs.push("Board \"" + String(boardText || "").trim() + "\" is not in the catalog. Pick it from the dropdown."); return out; }
  out.board = b.id;
  const c = classList(b.id).find((x) => n(x.name) === n(clsText) || n(x.id) === n(clsText) || n(x.name) === "class " + n(clsText));
  if (!c) { out.errs.push("Class \"" + String(clsText || "").trim() + "\" is not a class of " + b.name + " in the catalog."); return out; }
  out.cls = c.id;
  const s = subjectList(b.id, c.id).find((x) => n(x.name) === n(subjectText) || n(x.id) === n(subjectText) || n(x.code) === n(subjectText));
  if (!s) { out.errs.push("Subject \"" + String(subjectText || "").trim() + "\" is not a subject of " + b.name + " " + c.name + " in the catalog."); return out; }
  out.subject = s.id;
  return out;
}

/* ── Access levels ── */
export function levelsFor(board, cls, subject) {
  return Object.keys(C().levels).filter((id) => {
    const l = C().levels[id];
    return l.board === board && l.cls === cls && l.subject === subject;
  });
}
function levelOrder(id) {
  const l = C().levels[id];
  const b = C().boards[l.board] || {}, c = C().classes[k2(l.board, l.cls)] || {}, s = C().subjects[k3(l.board, l.cls, l.subject)] || {};
  return [b.order || 0, c.order || 0, s.order || 0];
}
function sortLevelIds(ids) {
  return ids.slice().sort((a, b) => {
    const x = levelOrder(a), y = levelOrder(b);
    return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]) || a.localeCompare(b);
  });
}
export const allLevelIds = () => sortLevelIds(C().allLevelIds.filter((id) => C().levels[id]));
export const activeLevelIds = () => sortLevelIds(C().activeLevelIds.filter((id) => C().levels[id]));
export function levelActive(id) { return !!(C().levels[id] && C().levels[id].active); }

export function levelInfo(id) {
  const l = C().levels[id];
  if (!l) return null;
  return {
    level: id, board: l.board, cls: l.cls, subject: l.subject, subjects: [l.subject],
    label: courseLabel(l.board, l.cls), subjectName: subjectName(l.board, l.cls, l.subject), active: !!l.active
  };
}
export function levelLabel(id) {
  const l = C().levels[id];
  return l ? scopeLabel(l.board, l.cls, l.subject) : (id || "");
}

/* ── What a student record holds (older records are read as converted) ── */
export function profileLevels(p) {
  if (!p) return [];
  if (Array.isArray(p.accessLevels)) return p.accessLevels.slice();
  return expandLegacy(p.accessLevel ? [p.accessLevel] : []);
}
export function requestedLevelsOf(p) {
  if (!p) return [];
  if (Array.isArray(p.requestedLevels)) return p.requestedLevels.slice();
  return expandLegacy(p.requestedLevel ? [p.requestedLevel] : []);
}

/* Readable text for what a student applied for. */
export function describeLevels(ids) {
  const courses = [], subjects = [];
  (ids || []).forEach((id) => {
    const l = C().levels[id];
    if (!l) return;
    const cl = courseLabel(l.board, l.cls), sn = subjectName(l.board, l.cls, l.subject);
    if (courses.indexOf(cl) === -1) courses.push(cl);
    if (subjects.indexOf(sn) === -1) subjects.push(sn);
  });
  return { course: courses.join(", "), subjects: subjects.join(" & ") };
}
export function describeRequest(profile) {
  return describeLevels(requestedLevelsOf(profile));
}

/* ───────────────────────── ProfAdmin changes ───────────────────────── */

const NAME_MAX = 40;
const cleanName = (t) => String(t || "").replace(/\s+/g, " ").trim();
const fail = (message) => ({ ok: false, message: message });
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function slug(name, keepCase) {
  let s = cleanName(name).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!keepCase) s = s.toLowerCase();
  return s.slice(0, 30);
}
function uniqueKey(exists, base) {
  let id = base || "x", n = 2;
  while (exists(id)) { id = base + "-" + n; n += 1; }
  return id;
}
function classCodeFromName(name) {
  const m = String(name).match(/\d+/);
  const t = m ? m[0] : String(name).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return t.slice(0, 6) || "X";
}
function nextOrder(obj, pick) {
  let max = 0;
  Object.keys(obj).forEach((k) => { if (pick(obj[k]) && (obj[k].order || 0) > max) max = obj[k].order; });
  return max + 1;
}

/* Reads the document, lets fn change a copy, and writes it back in one transaction. */
async function mutate(fn) {
  const ref = catRef();
  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists() ? pickCatalog(snap.data()) : finalize(clone(SEED));
    const next = clone({ boards: cur.boards, classes: cur.classes, subjects: cur.subjects, levels: cur.levels });
    const res = fn(next);
    if (res && res.ok === false) return res;
    finalize(next);
    tx.set(ref, {
      boards: next.boards, classes: next.classes, subjects: next.subjects, levels: next.levels,
      activeLevelIds: next.activeLevelIds, allLevelIds: next.allLevelIds, updatedAt: serverTimestamp()
    });
    return { ok: true, next: next, value: res && res.value };
  });
  if (result.ok) CAT = result.next;
  return result;
}

export function addBoard(name, code) {
  name = cleanName(name); code = String(code || "").trim().toUpperCase();
  if (!name || name.length > NAME_MAX) return Promise.resolve(fail("Enter a board name of up to " + NAME_MAX + " characters."));
  if (!/^[A-Z0-9]{1,8}$/.test(code)) return Promise.resolve(fail("The short code must be 1 to 8 letters or digits (for example NEET)."));
  return mutate((c) => {
    if (Object.keys(c.boards).some((id) => same(c.boards[id].name, name))) return fail("A board with this name already exists.");
    if (Object.keys(c.boards).some((id) => same(c.boards[id].code, code) || same(id, code))) return fail("That short code is already used by another board.");
    c.boards[code] = { name: name, code: code, order: nextOrder(c.boards, () => true) };
    return { value: code };
  });
}

export function renameBoard(id, name) {
  name = cleanName(name);
  if (!name || name.length > NAME_MAX) return Promise.resolve(fail("Enter a board name of up to " + NAME_MAX + " characters."));
  return mutate((c) => {
    if (!c.boards[id]) return fail("This board no longer exists.");
    if (Object.keys(c.boards).some((x) => x !== id && same(c.boards[x].name, name))) return fail("A board with this name already exists.");
    c.boards[id].name = name;
  });
}

export function addClass(board, name) {
  name = cleanName(name);
  if (!name || name.length > NAME_MAX) return Promise.resolve(fail("Enter a class name of up to " + NAME_MAX + " characters (for example Class 11)."));
  return mutate((c) => {
    if (!c.boards[board]) return fail("This board no longer exists.");
    const mine = Object.keys(c.classes).map((k) => c.classes[k]).filter((x) => x.board === board);
    if (mine.some((x) => same(x.name, name))) return fail("This board already has a class with that name.");
    const id = uniqueKey((x) => !!c.classes[k2(board, x)], slug(name, false) || "class");
    let code = classCodeFromName(name), n = 2;
    while (mine.some((x) => x.code === code)) { code = classCodeFromName(name) + String.fromCharCode(64 + n); n += 1; }
    c.classes[k2(board, id)] = { board: board, id: id, name: name, code: code, order: nextOrder(c.classes, (x) => x.board === board) };
    return { value: id };
  });
}

export function renameClass(board, cls, name) {
  name = cleanName(name);
  if (!name || name.length > NAME_MAX) return Promise.resolve(fail("Enter a class name of up to " + NAME_MAX + " characters."));
  return mutate((c) => {
    const x = c.classes[k2(board, cls)];
    if (!x) return fail("This class no longer exists.");
    const mine = Object.keys(c.classes).map((k) => c.classes[k]).filter((y) => y.board === board && y.id !== cls);
    if (mine.some((y) => same(y.name, name))) return fail("This board already has a class with that name.");
    x.name = name;
  });
}

/* Adding a subject also creates its access level, hidden from sign-up until switched on. */
export function addSubject(board, cls, name, code) {
  name = cleanName(name); code = String(code || "").trim().toUpperCase();
  if (!name || name.length > NAME_MAX) return Promise.resolve(fail("Enter a subject name of up to " + NAME_MAX + " characters."));
  if (!/^[A-Z0-9]{1,5}$/.test(code)) return Promise.resolve(fail("The short code must be 1 to 5 letters or digits (for example BIO)."));
  return mutate((c) => {
    if (!c.classes[k2(board, cls)]) return fail("This class no longer exists.");
    const mine = Object.keys(c.subjects).map((k) => c.subjects[k]).filter((x) => x.board === board && x.cls === cls);
    if (mine.some((x) => same(x.name, name))) return fail("This class already has a subject with that name.");
    if (mine.some((x) => x.code === code)) return fail("That short code is already used by another subject of this class.");
    const id = uniqueKey((x) => !!c.subjects[k3(board, cls, x)], slug(name, true) || "Subject");
    c.subjects[k3(board, cls, id)] = {
      board: board, cls: cls, id: id, name: name, code: code,
      order: nextOrder(c.subjects, (x) => x.board === board && x.cls === cls)
    };
    const bc = c.boards[board].code, cc = c.classes[k2(board, cls)].code;
    const base = (bc + cc + code).replace(/[^A-Za-z0-9]/g, "") + "Students";
    const levelId = uniqueKey((x) => !!c.levels[x], base);
    c.levels[levelId] = { board: board, cls: cls, subject: id, active: false };
    return { value: { subject: id, level: levelId } };
  });
}

export function renameSubject(board, cls, subject, name) {
  name = cleanName(name);
  if (!name || name.length > NAME_MAX) return Promise.resolve(fail("Enter a subject name of up to " + NAME_MAX + " characters."));
  return mutate((c) => {
    const x = c.subjects[k3(board, cls, subject)];
    if (!x) return fail("This subject no longer exists.");
    const mine = Object.keys(c.subjects).map((k) => c.subjects[k]).filter((y) => y.board === board && y.cls === cls && y.id !== subject);
    if (mine.some((y) => same(y.name, name))) return fail("This class already has a subject with that name.");
    x.name = name;
  });
}

export function setLevelActive(levelId, active) {
  return mutate((c) => {
    if (!c.levels[levelId]) return fail("This access level no longer exists.");
    c.levels[levelId].active = !!active;
  });
}

/* ── Deletion: only when nothing depends on it ── */
async function anyDoc(q) {
  const s = await getDocs(query(...q, limit(1)));
  return !s.empty;
}

export async function deleteBoard(id) {
  const has = Object.keys(C().classes).some((k) => C().classes[k].board === id);
  if (has) return fail("This board still has classes. Delete its classes first.");
  return mutate((c) => {
    if (Object.keys(c.classes).some((k) => c.classes[k].board === id)) return fail("This board still has classes. Delete its classes first.");
    delete c.boards[id];
  });
}

export async function deleteClass(board, cls) {
  const has = Object.keys(C().subjects).some((k) => C().subjects[k].board === board && C().subjects[k].cls === cls);
  if (has) return fail("This class still has subjects. Delete its subjects first.");
  return mutate((c) => {
    delete c.classes[k2(board, cls)];
  });
}

export async function deleteSubject(board, cls, subject) {
  if (await anyDoc([collection(db, "taxonomy"), where("board", "==", board), where("cls", "==", cls), where("subject", "==", subject)])) {
    return fail("This subject still has chapters. Delete its chapters (and their questions) first.");
  }
  const lv = levelsFor(board, cls, subject);
  for (const id of lv) {
    if (await anyDoc([collection(db, "users"), where("accessLevels", "array-contains", id)])
      || await anyDoc([collection(db, "users"), where("requestedLevels", "array-contains", id)])
      || await anyDoc([collection(db, "users"), where("accessLevel", "==", id)])) {
      return fail("Students hold or have applied for this subject's access level. Remove it from them first, or hide it from sign-up instead.");
    }
    if (await anyDoc([collection(db, "papers"), where("levels", "array-contains", id)])) {
      return fail("A paper is set for this subject. Delete the paper first.");
    }
  }
  return mutate((c) => {
    delete c.subjects[k3(board, cls, subject)];
    Object.keys(c.levels).forEach((id) => {
      const l = c.levels[id];
      if (l.board === board && l.cls === cls && l.subject === subject) delete c.levels[id];
    });
  });
}
