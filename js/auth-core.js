/* ─────────────────────────────────────────────────────────────────────
 * auth-core.js  (ES module)
 * Single place for Firebase init, Google sign-in, access-level mapping and
 * routing. Loaded (a) by header-footer-loader.js via an injected
 * <script type="module"> so every page's header knows the sign-in state,
 * and (b) imported directly by auth/, dashboard and admin pages.
 * The browser caches one instance per URL, so Firebase initialises once.
 *
 * Firebase web config values are public identifiers by design. Access is
 * protected by Firebase Auth, Firestore Security Rules and the authorized
 * domains list, never by hiding these values.
 * ───────────────────────────────────────────────────────────────────── */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDRvqlW7RsbpzBKChwWGmNoM3jXlNGr3IE",
  authDomain: "profbalaji-scienceacademy.firebaseapp.com",
  projectId: "profbalaji-scienceacademy",
  storageBucket: "profbalaji-scienceacademy.firebasestorage.app",
  messagingSenderId: "545786735680",
  appId: "1:545786735680:web:094ad383abe455107743a5"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

/* Site root, derived from this file's own URL (works at any page depth). */
const ROOT = new URL("../", import.meta.url).href;
export const ROUTES = {
  login: ROOT + "auth/",
  dashboard: ROOT + "pages/dashboard/",
  admin: ROOT + "pages/admin/",
  home: ROOT + "index.html"
};

/* ── Class / board / subject choices → one of the seven access levels ── */
export const COURSES = [
  { id: "cbse10", board: "CBSE", cls: "10", label: "CBSE Class 10", subjects: [
    { label: "Science", list: ["Science"], level: "C10SciStudents" }
  ]},
  { id: "cbse12", board: "CBSE", cls: "12", label: "CBSE Class 12", subjects: [
    { label: "Physics", list: ["Physics"], level: "C12PhyStudents" },
    { label: "Chemistry", list: ["Chemistry"], level: "C12ChemStudents" },
    { label: "Physics & Chemistry", list: ["Physics", "Chemistry"], level: "C12PhyChemStudents" }
  ]},
  { id: "sb12", board: "State Board", cls: "12", label: "State Board Class 12", subjects: [
    { label: "Physics", list: ["Physics"], level: "S12PhyStudents" },
    { label: "Chemistry", list: ["Chemistry"], level: "S12ChemStudents" },
    { label: "Physics & Chemistry", list: ["Physics", "Chemistry"], level: "S12PhyChemStudents" }
  ]}
];

/* Human-readable text for a stored profile's request. */
export function describeRequest(profile) {
  if (!profile) return { course: "", subjects: "" };
  const c = COURSES.find(x => x.board === profile.requestedBoard && x.cls === profile.requestedClass);
  return {
    course: c ? c.label : (profile.requestedBoard + " Class " + profile.requestedClass),
    subjects: (profile.requestedSubjects || []).join(" & ")
  };
}

/* ── Account state (2 reads; used only by auth, dashboard and admin pages) ── */
export async function loadAccount(user) {
  const email = (user.email || "").toLowerCase();
  let isAdmin = false;
  try {
    isAdmin = (await getDoc(doc(db, "admins", email))).exists();
  } catch (e) { isAdmin = false; }
  let profile = null;
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) profile = snap.data();
  return { isAdmin, profile };
}

/* A profile counts as complete only when the onboarding answers exist.
 * The users document is created only when onboarding is submitted, so an
 * abandoned onboarding simply asks the same questions on the next login. */
export function isComplete(profile) {
  return !!(profile && profile.name && profile.requestedLevel && profile.status);
}

export function routeFor(account) {
  if (account.isAdmin) return ROUTES.admin;
  if (!isComplete(account.profile)) return ROUTES.login;
  return ROUTES.dashboard;
}

/* ── Actions ── */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

export function signOutUser() { return signOut(auth); }

export async function submitApplication(user, { name, courseId, subjectLabel }) {
  const course = COURSES.find(c => c.id === courseId);
  const subj = course && course.subjects.find(s => s.label === subjectLabel);
  if (!course || !subj) throw new Error("Invalid selection");
  await setDoc(doc(db, "users", user.uid), {
    name: name,
    email: user.email,
    photoURL: user.photoURL || "",
    requestedBoard: course.board,
    requestedClass: course.cls,
    requestedSubjects: subj.list,
    requestedLevel: subj.level,
    status: "pending",
    accessLevel: "",
    createdAt: serverTimestamp()
  });
}

export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }

/* ── Share sign-in state with the shared header (classic script) ── */
const state = window.PB_AUTH = window.PB_AUTH || {};
state.ready = false;
state.user = null;
state.signOut = signOutUser;

onAuthStateChanged(auth, function (user) {
  state.ready = true;
  state.user = user ? { name: user.displayName || "", email: user.email || "" } : null;
  try {
    if (user) {
      localStorage.setItem("pb_user_hint", JSON.stringify({ name: state.user.name, email: state.user.email }));
    } else {
      localStorage.removeItem("pb_user_hint");
    }
  } catch (e) { /* storage unavailable: header just skips the hint */ }
  window.dispatchEvent(new CustomEvent("pb-auth", { detail: { user: state.user } }));
});
