/* ─────────────────────────────────────────────────────────────────────
 * analytics-logic.js  (ES module, Phase 8: question-level analytics)
 * Pure rules, no database code: shrinking an attempt record to what the
 * analytics need (never the student's identity, L-18), adding attempts up per
 * question, the difficulty flag, roll-ups and CSV text.
 * ───────────────────────────────────────────────────────────────────── */

/* Types answered by choosing options; their answers are stored as option
 * numbers (0 = first option; True = 0, False = 1 for True / False). */
export const OPTION_TYPES = ["mcq_single", "mcq_multi", "true_false", "assertion_reason"];
/* Types with exactly one correct option, so a wrong pick can be read without the key. */
export const SINGLE_TYPES = ["mcq_single", "true_false", "assertion_reason"];

/* Difficulty flag (owner, Phase 8): nothing is flagged below this many scored attempts. */
export const MIN_ATTEMPTS = 10;
export const FLAG_RULES = {
  Easy: { below: 40 },
  Medium: { below: 25, above: 90 },
  Hard: { above: 80 }
};

/* One stored attempt -> the small row kept for analytics. The student's UID
 * is deliberately dropped. */
export function compactAttempt(id, d) {
  if (!d || typeof d.questionId !== "string") return null;
  const mode = d.mode === "mock" ? "m" : "p";
  const ans = d.answer || {};
  const sel = OPTION_TYPES.indexOf(d.type) !== -1 && Array.isArray(ans.sel)
    ? ans.sel.filter((n) => Number.isInteger(n) && n >= 0 && n < 20) : null;
  return {
    id: id,
    q: d.questionId,
    c: d.chapterId || "",
    mode: mode,
    type: d.type || "",
    diff: d.difficulty || "",
    scored: d.scored === true ? 1 : 0,
    ok: d.isCorrect === true ? 1 : 0,
    sel: sel,
    secs: mode === "p" && typeof d.timeSpent === "number" ? d.timeSpent : null,
    sid: mode === "m" && typeof d.sessionId === "string" ? d.sessionId : "",
    pid: typeof d.paperId === "string" ? d.paperId : "",
    ms: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0,
    board: d.board || "",
    cls: d.cls || "",
    subject: d.subject || ""
  };
}

/* f: { mode: "all" | "practice" | "mock", chapterId, board, cls, subject, paperId } */
export function filterRows(rows, f) {
  return rows.filter((r) => {
    if (f.mode === "practice" && r.mode !== "p") return false;
    if (f.mode === "mock" && r.mode !== "m") return false;
    if (f.chapterId && r.c !== f.chapterId) return false;
    if (f.board && r.board !== f.board) return false;
    if (f.cls && r.cls !== f.cls) return false;
    if (f.subject && r.subject !== f.subject) return false;
    if (f.paperId && r.pid !== f.paperId) return false;
    return true;
  });
}

const round1 = (x) => Math.round(x * 10) / 10;

/* Percent correct over auto-marked attempts only (written types are
 * self-assessed and excluded, L-40). null when nothing was auto-marked. */
export const percent = (correct, scored) => (scored > 0 ? round1((100 * correct) / scored) : null);

/* Adds attempts up per question. */
export function aggregate(rows) {
  const m = new Map();
  rows.forEach((r) => {
    let a = m.get(r.q);
    if (!a) {
      a = { q: r.q, c: r.c, type: r.type, diff: r.diff, attempts: 0, scored: 0, correct: 0,
            secsSum: 0, secsN: 0, picks: {}, pickN: 0, wrong: {}, lastMs: -1 };
      m.set(r.q, a);
    }
    a.attempts++;
    if (r.scored) { a.scored++; if (r.ok) a.correct++; }
    if (r.secs != null) { a.secsSum += r.secs; a.secsN++; }
    if (r.sel && r.sel.length) {
      a.pickN++;
      r.sel.forEach((i) => { a.picks[i] = (a.picks[i] || 0) + 1; });
      if (SINGLE_TYPES.indexOf(r.type) !== -1 && r.scored && !r.ok && r.sel.length === 1) {
        a.wrong[r.sel[0]] = (a.wrong[r.sel[0]] || 0) + 1;
      }
    }
    if (r.ms >= a.lastMs) { a.lastMs = r.ms; if (r.diff) a.diff = r.diff; }
  });
  return Array.from(m.values()).map((a) => {
    a.pct = percent(a.correct, a.scored);
    a.avgSecs = a.secsN > 0 ? a.secsSum / a.secsN : null;
    a.topWrong = topOf(a.wrong);
    a.wrongTotal = Object.keys(a.wrong).reduce((t, k) => t + a.wrong[k], 0);
    return a;
  });
}

/* The most chosen entry of { optionNumber: count }; ties go to the lower number. */
export function topOf(counts) {
  let best = null;
  Object.keys(counts).map(Number).sort((x, y) => x - y).forEach((k) => {
    if (best === null || counts[k] > best.n) best = { idx: k, n: counts[k] };
  });
  return best;
}

/* Most chosen wrong option when the correct options are known (needed for
 * multiple-correct questions). correct: array of option numbers. */
export function topWrongWithKey(picks, correct) {
  const wrong = {};
  Object.keys(picks).forEach((k) => { if (correct.indexOf(Number(k)) === -1) wrong[k] = picks[k]; });
  return topOf(wrong);
}

/* Difficulty flag: compares the tag with how students actually did.
 * Returns null or { kind: "harder" | "easier", short, text }. */
export function difficultyFlag(diff, pct, scored) {
  const r = FLAG_RULES[diff];
  if (!r || pct === null || scored < MIN_ATTEMPTS) return null;
  if (typeof r.below === "number" && pct < r.below) {
    return { kind: "harder", short: "Harder than tagged",
      text: "Tagged " + diff + ", but only " + pct + "% of " + scored + " scored attempts were correct." };
  }
  if (typeof r.above === "number" && pct > r.above) {
    return { kind: "easier", short: "Easier than tagged",
      text: "Tagged " + diff + ", but " + pct + "% of " + scored + " scored attempts were correct." };
  }
  return null;
}

/* Totals across a list of per-question results. */
export function overall(aggs) {
  const t = { questions: aggs.length, attempts: 0, scored: 0, correct: 0, secsSum: 0, secsN: 0 };
  aggs.forEach((a) => {
    t.attempts += a.attempts; t.scored += a.scored; t.correct += a.correct;
    t.secsSum += a.secsSum; t.secsN += a.secsN;
  });
  t.pct = percent(t.correct, t.scored);
  t.avgSecs = t.secsN > 0 ? t.secsSum / t.secsN : null;
  return t;
}

/* Per-chapter totals from per-question results. */
export function rollupByChapter(aggs) {
  const m = new Map();
  aggs.forEach((a) => {
    let r = m.get(a.c);
    if (!r) { r = { c: a.c, questions: 0, attempts: 0, scored: 0, correct: 0, secsSum: 0, secsN: 0 }; m.set(a.c, r); }
    r.questions++; r.attempts += a.attempts; r.scored += a.scored; r.correct += a.correct;
    r.secsSum += a.secsSum; r.secsN += a.secsN;
  });
  return Array.from(m.values()).map((r) => {
    r.pct = percent(r.correct, r.scored);
    r.avgSecs = r.secsN > 0 ? r.secsSum / r.secsN : null;
    return r;
  });
}

/* Number of different tests (sessions) among mock rows. */
export const countSessions = (rows) => new Set(rows.filter((r) => r.sid).map((r) => r.sid)).size;

/* Display helpers */
export function optionLabel(type, i) {
  if (type === "true_false") return i === 0 ? "True" : "False";
  return String.fromCharCode(65 + i);
}

export function fmtSecs(s) {
  if (s === null || s === undefined || !isFinite(s)) return "—";
  const t = Math.round(s);
  if (t < 60) return t + " s";
  return Math.floor(t / 60) + " min " + String(t % 60).padStart(2, "0") + " s";
}

export const fmtPct = (p) => (p === null || p === undefined ? "—" : p + "%");

/* CSV text (with a leading byte-order mark so Excel reads it correctly).
 * Text cells that start with = + - or @ are prefixed with an apostrophe so a
 * spreadsheet never treats them as a formula. */
export function toCsv(headers, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  };
  const lines = [headers].concat(rows).map((r) => r.map(cell).join(","));
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}
