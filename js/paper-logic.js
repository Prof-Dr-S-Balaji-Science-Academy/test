/* ─────────────────────────────────────────────────────────────────────
 * paper-logic.js  (ES module, Phase 7: papers and mock tests)
 * Pure functions only: no Firebase and no page code, so they can be tested
 * on their own. Used by paper-admin.js (paper builder), paper-core.js
 * (data layer) and test-ui.js (student test).
 *
 *  - Which question types are marked on screen in a mock test (L-65)
 *  - Choosing the questions of a rule-based paper (difficulty mix, types,
 *    at most one question per Grouping label, L-57)
 *  - Shuffling questions and options
 *  - Scoring a finished test, with optional negative marking
 *  - Checking the paper form
 * ───────────────────────────────────────────────────────────────────── */

/* Only these types are answered on screen and marked in a mock test.
 * Every other type is written on paper and self-evaluated (owner, 2026-10-09). */
export const EVALUATED = ["mcq_single", "mcq_multi", "assertion_reason"];
export const isEvaluated = (type) => EVALUATED.indexOf(type) !== -1;

/* Negative-marking choices: the fraction of a question's marks taken off for a
 * wrong answer. Unanswered questions never lose marks. */
export const NEGATIVE_CHOICES = [
  { value: 0, label: "No negative marking" },
  { value: 0.25, label: "One quarter of the marks" },
  { value: 1 / 3, label: "One third of the marks" },
  { value: 0.5, label: "Half of the marks" },
  { value: 1, label: "Full marks" }
];

export const MAX_QUESTIONS = 100;
export const GRACE_SECONDS = 60;

export const round2 = (n) => Math.round(n * 100) / 100;

/* ── Randomness (rnd can be replaced in tests) ── */
export function shuffled(arr, rnd) {
  const r = rnd || Math.random;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ── Grouping (L-57): same chapter + same label, ignoring capitals ── */
export function groupKey(q) {
  const g = typeof q.grouping === "string" ? q.grouping.trim().toLowerCase().replace(/\s+/g, " ") : "";
  return g ? String(q.chapterId) + "|" + g : null;
}

/* Chooses the questions of a rule-based paper.
 * pool: all candidate questions (already limited to the chapters, types and
 *       published status the rules name).
 * mix:  { Easy: n, Medium: n, Hard: n }.
 * Takes the wanted number of each difficulty, never two questions of one
 * group. Returns { ok, picked, shortBy } where shortBy lists the difficulties
 * that could not be filled; picked is empty when ok is false. */
export function pickRuleQuestions(pool, mix, rnd) {
  const used = new Set();
  const picked = [];
  const shortBy = {};
  ["Easy", "Medium", "Hard"].forEach((d) => {
    const want = Math.max(0, parseInt(mix[d], 10) || 0);
    if (!want) return;
    const cand = shuffled(pool.filter((q) => q.difficulty === d), rnd);
    let got = 0;
    for (let i = 0; i < cand.length && got < want; i++) {
      const k = groupKey(cand[i]);
      if (k && used.has(k)) continue;
      if (k) used.add(k);
      picked.push(cand[i]);
      got += 1;
    }
    if (got < want) shortBy[d] = want - got;
  });
  if (Object.keys(shortBy).length) return { ok: false, picked: [], shortBy: shortBy };
  return { ok: true, picked: picked, shortBy: {} };
}

/* ── Option order. Only single and multiple choice are shuffled; the four
 * standard Assertion and Reason options keep their usual order. ── */
export function buildOptionOrder(questions, shuffle, rnd) {
  const out = {};
  if (!shuffle) return out;
  questions.forEach((q) => {
    if ((q.type === "mcq_single" || q.type === "mcq_multi") && (q.options || []).length > 1) {
      out[q.id] = shuffled((q.options || []).map((_, i) => i), rnd);
    }
  });
  return out;
}

/* The options of a question in the order the student sees them.
 * Returns [{ orig, text }]. perm is the stored order for this question. */
export function displayOptions(q, perm) {
  const opts = q.options || [];
  const order = (perm && perm.length === opts.length) ? perm : opts.map((_, i) => i);
  return order.map((orig) => ({ orig: orig, text: opts[orig] }));
}

/* ── Marking one answered question: true / false ── */
function sameSet(a, b) {
  const x = Array.from(new Set(a)).sort(), y = Array.from(new Set(b)).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
export function isCorrect(type, key, answer) {
  const sel = (answer && answer.sel) || [];
  const correct = (key && key.correct) || [];
  if (type === "mcq_multi") return sel.length > 0 && sameSet(sel, correct);
  if (type === "mcq_single" || type === "assertion_reason") return sel.length === 1 && correct.indexOf(sel[0]) !== -1;
  return false;
}

/* ── Scoring a submitted test ──
 * order:   question IDs in the order of the paper
 * qs:      { id: question }  (a missing entry means the question is gone)
 * keys:    { id: answer key }
 * answers: { id: { sel: [...] } } as saved in the session
 * neg:     fraction of marks lost for a wrong answer (0 to 1)
 * Returns totals plus a status for every question:
 *   correct | wrong | unanswered | paper (written on paper, self-evaluated) | missing */
export function scoreSession(order, qs, keys, answers, neg) {
  const per = {};
  let score = 0, evalMax = 0, selfMarks = 0, selfCount = 0, right = 0, wrong = 0, blank = 0;
  order.forEach((id) => {
    const q = qs[id];
    if (!q) { per[id] = { status: "missing", delta: 0 }; return; }
    const marks = Number(q.marks) || 0;
    if (!isEvaluated(q.type)) {
      per[id] = { status: "paper", delta: 0 };
      selfMarks += marks; selfCount += 1;
      return;
    }
    evalMax += marks;
    const a = answers && answers[id];
    if (!a || !a.sel || !a.sel.length) { per[id] = { status: "unanswered", delta: 0 }; blank += 1; return; }
    if (isCorrect(q.type, keys[id], a)) { per[id] = { status: "correct", delta: marks }; score += marks; right += 1; }
    else {
      const d = -round2(marks * (neg || 0));
      per[id] = { status: "wrong", delta: d }; score += d; wrong += 1;
    }
  });
  return {
    score: round2(score), evalMax: round2(evalMax), selfMarks: round2(selfMarks), selfCount: selfCount,
    correct: right, wrong: wrong, unanswered: blank, per: per
  };
}

/* ── Clock text ── */
export function clockText(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? h + ":" + p(m) + ":" + p(r) : p(m) + ":" + p(r);
}

/* ── Paper form check ──
 * f: { title, levels[], mode, durationMin, negativeMarking, count,
 *      questionIds[] (fixed), chapterIds[], types[], mix{} (rule) }
 * Returns an error message, or "" when the form is fine. */
export function checkPaperForm(f) {
  const title = String(f.title || "").trim();
  if (!title) return "Enter a title for the paper.";
  if (title.length > 120) return "The title can be at most 120 characters.";
  if (String(f.description || "").length > 500) return "The description can be at most 500 characters.";
  if (!f.levels || !f.levels.length) return "Choose at least one student level for this paper.";
  const d = Number(f.durationMin);
  if (!Number.isInteger(d) || d < 1 || d > 300) return "The duration must be a whole number of minutes from 1 to 300.";
  const n = Number(f.negativeMarking);
  if (!isFinite(n) || n < 0 || n > 1) return "Choose a valid negative marking option.";
  if (f.mode === "fixed") {
    const ids = f.questionIds || [];
    if (!ids.length) return "Add at least one question to the paper.";
    if (ids.length > MAX_QUESTIONS) return "A paper can have at most " + MAX_QUESTIONS + " questions.";
    if (new Set(ids).size !== ids.length) return "A question appears twice in the paper.";
    return "";
  }
  if (f.mode === "rule") {
    if (!(f.chapterIds || []).length) return "Choose at least one chapter for the rules.";
    if ((f.chapterIds || []).length > 30) return "Choose at most 30 chapters.";
    if (!(f.types || []).length) return "Choose at least one question type.";
    let total = 0;
    for (const k of ["Easy", "Medium", "Hard"]) {
      const v = Number((f.mix || {})[k]);
      if (!Number.isInteger(v) || v < 0 || v > MAX_QUESTIONS) return "Enter whole numbers from 0 to " + MAX_QUESTIONS + " for each difficulty.";
      total += v;
    }
    if (total < 1) return "Ask for at least one question.";
    if (total > MAX_QUESTIONS) return "A paper can have at most " + MAX_QUESTIONS + " questions.";
    return "";
  }
  return "Choose how the paper is made.";
}
