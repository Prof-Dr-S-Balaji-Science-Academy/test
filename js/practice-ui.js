/* ─────────────────────────────────────────────────────────────────────
 * practice-ui.js  (ES module, student practice mode; practice is not saved, Rules v10)
 * Subject → chapter → practice, limited to the student's own access level.
 * Everything here is display; the real lock is Firestore Rules v10.
 * All text from the database is inserted with textContent (never as HTML)
 * and LaTeX is typeset by MathJax, which the dashboard page loads.
 * ───────────────────────────────────────────────────────────────────── */
import { typeLabel, TYPES, DIFFICULTIES } from "./question-core.js";
import {
  levelInfo, fetchChapters, countPublished, fetchSessionQuestions, fetchKeys,
  markQuestion, isWritten, PRACTICE_MAX
} from "./practice-core.js";
import * as PDF from "./result-pdf.js";

const IMG_PREFIX = "https://ik.imagekit.io/profbalaji/";
const letter = (i) => String.fromCharCode(65 + i);
export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const marksText = (m) => m + (m === 1 ? " mark" : " marks");
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + "%" : "–");

/* ── MathJax: typesetting is queued one node at a time ── */
let chain = Promise.resolve();
function waitMathJax() {
  return new Promise((resolve) => {
    let n = 0;
    (function t() {
      if (window.MathJax && window.MathJax.typesetPromise) return resolve();
      if (++n > 150) return resolve();
      setTimeout(t, 100);
    })();
  });
}
export function typeset(node) {
  chain = chain.then(waitMathJax).then(() => (window.MathJax && window.MathJax.typesetPromise
    ? window.MathJax.typesetPromise([node]) : null)).catch((e) => console.error(e));
}
export function clearMath(node) {
  if (window.MathJax && window.MathJax.typesetClear) { try { window.MathJax.typesetClear([node]); } catch (e) { /* ignore */ } }
}

const BACK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const ARROW_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

/* ───────────────────────── Question building blocks ───────────────────────── */

export function latexBlock(cls, text) {
  const d = el("div", "pq-latex" + (cls ? " " + cls : ""));
  d.textContent = text || "";
  return d;
}

export function imageBox(url, alt) {
  if (typeof url !== "string" || url.indexOf(IMG_PREFIX) !== 0) return null;
  const box = el("div", "pq-imgbox");
  const img = el("img", "pq-img");
  img.loading = "lazy";
  img.alt = alt;
  img.src = url;
  box.append(img);
  return box;
}

let uid = 0;

/* One answerable part: a whole (non case-based) question, or one sub-question.
 * Returns { root, isComplete(), getAnswer(), lock(), reveal(key) }. */
function buildPart(type, item, withStem, stemLabel) {
  const root = el("div", "pq-part");
  if (type === "assertion_reason") {
    const a = el("div", "pq-ar"); a.append(el("strong", null, "Assertion (A): "), latexBlock("pq-inline", item.assertionLatex));
    const r = el("div", "pq-ar"); r.append(el("strong", null, "Reason (R): "), latexBlock("pq-inline", item.reasonLatex));
    root.append(a, r);
  } else if (withStem) {
    if (stemLabel) root.append(el("div", "pq-sublabel", stemLabel));
    root.append(latexBlock("pq-stem", item.questionLatex));
  } else if (stemLabel) {
    root.append(el("div", "pq-sublabel", stemLabel));
  }

  const name = "pq" + (++uid);
  let api;

  if (type === "mcq_single" || type === "mcq_multi" || type === "assertion_reason" || type === "true_false") {
    const multi = type === "mcq_multi";
    const texts = type === "true_false" ? ["True", "False"] : (item.options || []);
    const wrap = el("div", "pq-opts");
    if (multi) wrap.append(el("div", "pq-hint", "Select every correct option."));
    const inputs = [], labels = [];
    texts.forEach((t, i) => {
      const lab = el("label", "pq-opt");
      const inp = el("input");
      inp.type = multi ? "checkbox" : "radio"; inp.name = name; inp.value = String(i);
      lab.append(inp, el("span", "pq-opt-l", letter(i)));
      const tx = latexBlock("pq-opt-t", t);
      lab.append(tx);
      wrap.append(lab); inputs.push(inp); labels.push(lab);
    });
    root.append(wrap);
    api = {
      isComplete: () => inputs.some((x) => x.checked),
      getAnswer: () => ({ sel: inputs.map((x, i) => (x.checked ? i : -1)).filter((i) => i >= 0) }),
      lock: () => inputs.forEach((x) => { x.disabled = true; }),
      reveal: (key) => {
        const correct = (key && key.correct) || [];
        labels.forEach((lab, i) => {
          if (correct.indexOf(i) !== -1) { lab.classList.add("is-correct"); lab.append(el("span", "pq-flag", "Correct answer")); }
          else if (inputs[i].checked) { lab.classList.add("is-wrong"); lab.append(el("span", "pq-flag", "Your answer")); }
        });
      }
    };
  } else if (type === "fill_blank" || type === "numerical") {
    const f = el("div", "pq-fill");
    const inp = el("input", "input");
    inp.type = "text"; inp.autocomplete = "off"; inp.maxLength = 200;
    inp.setAttribute("autocapitalize", "off"); inp.spellcheck = false;
    if (type === "numerical") { inp.inputMode = "decimal"; inp.placeholder = "Enter a number"; }
    else inp.placeholder = "Type your answer";
    inp.setAttribute("aria-label", "Your answer");
    f.append(inp);
    root.append(f);
    const out = el("div", "pq-correct-line");
    out.hidden = true;
    root.append(out);
    api = {
      isComplete: () => inp.value.trim() !== "",
      getAnswer: () => ({ text: inp.value.trim().slice(0, 200) }),
      lock: () => { inp.readOnly = true; },
      reveal: (key) => {
        out.hidden = false;
        if (type === "numerical") {
          let t = "Correct answer: " + (typeof (key && key.numericAnswer) === "number" ? key.numericAnswer : "");
          if (key && key.tolerance > 0) t += " (accepted within ±" + key.tolerance + ")";
          out.textContent = t;
        } else {
          out.textContent = "Accepted answer" + (((key && key.acceptedAnswers) || []).length > 1 ? "s" : "") + ": " + ((key && key.acceptedAnswers) || []).join(", ");
        }
      }
    };
  } else if (type === "match") {
    const left = item.matchLeft || [], right = item.matchRight || [];
    const cols = el("div", "pq-matchcols");
    const lc = el("div", "pq-matchcol"); lc.append(el("div", "pq-sublabel", "Column I"));
    const rc = el("div", "pq-matchcol"); rc.append(el("div", "pq-sublabel", "Column II"));
    const selects = [], notes = [];
    left.forEach((t, i) => {
      const row = el("div", "pq-matchrow");
      row.append(el("span", "pq-opt-l", String(i + 1)), latexBlock("pq-opt-t", t));
      lc.append(row);
    });
    right.forEach((t, i) => {
      const row = el("div", "pq-matchrow");
      row.append(el("span", "pq-opt-l", letter(i)), latexBlock("pq-opt-t", t));
      rc.append(row);
    });
    cols.append(lc, rc);
    const picks = el("div", "pq-picks");
    left.forEach((_, i) => {
      const r = el("div", "pq-pick");
      r.append(el("span", "pq-pick-l", "Item " + (i + 1) + " matches"));
      const sel = el("select", "input");
      sel.setAttribute("aria-label", "Match for item " + (i + 1));
      const o0 = el("option", null, "Choose"); o0.value = ""; sel.append(o0);
      right.forEach((__, j) => { const o = el("option", null, letter(j)); o.value = String(j); sel.append(o); });
      const note = el("span", "pq-pick-note");
      r.append(sel, note);
      picks.append(r); selects.push(sel); notes.push(note);
    });
    root.append(cols, picks);
    api = {
      isComplete: () => selects.every((s) => s.value !== ""),
      getAnswer: () => ({ sel: selects.map((s) => parseInt(s.value, 10)) }),
      lock: () => selects.forEach((s) => { s.disabled = true; }),
      reveal: (key) => {
        const map = (key && key.matchMap) || [];
        selects.forEach((s, i) => {
          const ok = parseInt(s.value, 10) === map[i];
          notes[i].textContent = ok ? "Correct" : "Correct match: " + letter(map[i]);
          notes[i].classList.add(ok ? "is-correct" : "is-wrong");
        });
      }
    };
  } else {
    /* Written types: nothing to enter; the model answer is revealed. */
    root.append(el("div", "pq-hint", "Think through your answer, or write it on paper. Then show the model answer and compare."));
    const out = el("div", "pq-model");
    out.hidden = true;
    root.append(out);
    api = {
      isComplete: () => true,
      getAnswer: () => ({}),
      lock: () => {},
      reveal: (key) => {
        out.hidden = false;
        out.append(el("div", "pq-sublabel", "Model answer"), latexBlock("", (key && key.modelAnswerLatex) || ""));
      }
    };
  }
  api.root = root;
  return api;
}

/* A whole question card (case-based included). */
function buildQuestion(q) {
  const root = el("div", "pq-card");
  const tags = el("div", "pq-tags");
  tags.append(el("span", "q-tag q-id", q.displayId || ""), el("span", "q-tag", q.difficulty), el("span", "q-tag", marksText(q.marks)), el("span", "q-tag", typeLabel(q.type)));
  root.append(tags);

  const isCase = q.type === "case_based";
  let parts;
  if (isCase) {
    root.append(el("div", "pq-sublabel", "Read the passage"), latexBlock("pq-stem", q.questionLatex));
    const im = imageBox(q.imageUrl, "Figure for the question");
    if (im) root.append(im);
    parts = (q.subQuestions || []).map((s, i) => {
      const card = el("div", "pq-sub");
      card.append(el("div", "pq-subhead", "Sub-question " + (i + 1) + " · " + typeLabel(s.type) + " · " + marksText(s.marks)));
      const p = buildPart(s.type, s, true, null);
      card.append(p.root);
      root.append(card);
      return { type: s.type, part: p };
    });
  } else {
    const p = buildPart(q.type, q, q.type !== "assertion_reason", null);
    root.append(p.root);
    const im = imageBox(q.imageUrl, "Figure for the question");
    if (im) p.root.insertBefore(im, p.root.children[q.type === "assertion_reason" ? 2 : 1] || null);
    parts = [{ type: q.type, part: p }];
  }

  return {
    root: root,
    parts: parts,
    isComplete: () => parts.every((x) => isWritten(x.type) || x.part.isComplete()),
    getAnswer: () => (isCase
      ? { subs: parts.map((x) => x.part.getAnswer()) }
      : parts[0].part.getAnswer()),
    lock: () => parts.forEach((x) => x.part.lock()),
    reveal: (key) => {
      key = key || {};
      if (isCase) parts.forEach((x, i) => x.part.reveal((key.subKeys || [])[i]));
      else parts[0].part.reveal(key);
    }
  };
}

/* ───────────────────── Practice result report (PDF, same layout as the mock test PDF) ───────────────────── */

function reportPart(type, item, key, ans) {
  key = key || {}; ans = ans || {};
  const root = el("div", "rp-part");
  if (type === "assertion_reason") {
    const a = el("div", "pq-ar"); a.append(el("strong", null, "Assertion (A): "), latexBlock("pq-inline", item.assertionLatex));
    const r = el("div", "pq-ar"); r.append(el("strong", null, "Reason (R): "), latexBlock("pq-inline", item.reasonLatex));
    root.append(a, r);
  } else {
    root.append(latexBlock("pq-stem", item.questionLatex));
  }
  if (type === "mcq_single" || type === "mcq_multi" || type === "assertion_reason" || type === "true_false") {
    const texts = type === "true_false" ? ["True", "False"] : (item.options || []);
    const chosen = ans.sel || [], rights = key.correct || [];
    texts.forEach((t, i) => {
      const lab = el("div", "rp-opt" + (chosen.indexOf(i) !== -1 ? " is-chosen" : "") + (rights.indexOf(i) !== -1 ? " is-right" : ""));
      lab.append(el("span", "rp-opt-l", letter(i)), latexBlock("rp-opt-t", t));
      root.append(lab);
    });
    root.append(el("div", "rp-ans", "Your answer: " + (chosen.length ? chosen.map(letter).join(", ") : "not answered")));
    root.append(el("div", "rp-ans rp-ans-right", "Correct answer: " + (rights.length ? rights.map(letter).join(", ") : "not available")));
  } else if (type === "fill_blank") {
    root.append(el("div", "rp-ans", "Your answer: " + (ans.text ? ans.text : "not answered")));
    root.append(el("div", "rp-ans rp-ans-right", "Accepted answer: " + ((key.acceptedAnswers || []).join(", ") || "not available")));
  } else if (type === "numerical") {
    root.append(el("div", "rp-ans", "Your answer: " + (ans.text ? ans.text : "not answered")));
    root.append(el("div", "rp-ans rp-ans-right", "Correct answer: " + (typeof key.numericAnswer === "number" ? key.numericAnswer : "not available") + (key.tolerance > 0 ? " (within ±" + key.tolerance + ")" : "")));
  } else if (type === "match") {
    (item.matchLeft || []).forEach((t, i) => { const r = el("div", "rp-opt"); r.append(el("span", "rp-opt-l", String(i + 1)), latexBlock("rp-opt-t", t)); root.append(r); });
    (item.matchRight || []).forEach((t, i) => { const r = el("div", "rp-opt"); r.append(el("span", "rp-opt-l", letter(i)), latexBlock("rp-opt-t", t)); root.append(r); });
    const mine = (ans.sel || []).map((v, i) => (i + 1) + " \u2192 " + (v >= 0 ? letter(v) : "–")).join(", ");
    root.append(el("div", "rp-ans", "Your matches: " + (mine || "not answered")));
    root.append(el("div", "rp-ans rp-ans-right", "Correct matches: " + ((key.matchMap || []).map((m, i) => (i + 1) + " \u2192 " + letter(m)).join(", ") || "not available")));
  } else {
    root.append(el("div", "rp-ans", "Model answer:"));
    root.append(latexBlock("", key.modelAnswerLatex || ""));
  }
  return root;
}

function buildPracticeReport(r) {
  const { chapter, subjectLabel, rows, answers, keys, marks, status, summary, student } = r;
  const root = el("div", "rp-root");
  root.setAttribute("aria-hidden", "true");
  const head = el("div", "rp-block rp-head");
  head.append(el("div", "rp-brand", "Prof. Dr. S. Balaji Science Academy"),
    el("div", "rp-title", "Chapter " + chapter.chapterNumber + ": " + chapter.chapterName),
    el("div", "rp-sub", "Practice result"));
  const list = el("div", "rp-rows");
  const row = (k, v) => { const d = el("div", "rp-row"); d.append(el("span", "rp-k", k), el("span", "rp-v", v)); list.append(d); };
  row("Student", student.name || "–");
  row("Email", student.email || "–");
  row("Subject", subjectLabel);
  row("Date", new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }));
  row("Questions", String(rows.length));
  row("Correct (auto-marked)", summary.scored ? summary.correct + " / " + summary.scored + " (" + pct(summary.correct, summary.scored) + ")" : "–");
  row("Correct \u00b7 Wrong \u00b7 Not answered", summary.correct + " \u00b7 " + summary.wrong + " \u00b7 " + summary.unanswered);
  head.append(list);
  head.append(el("div", "rp-note", "Practice results are not saved by the academy. This PDF is your own copy."));
  root.append(head);

  rows.forEach((q, i) => {
    const card = el("div", "rp-block rp-q");
    const tags = el("div", "rp-tags");
    tags.append(el("span", "rp-tag", "Question " + (i + 1)), el("span", "rp-tag", marksText(q.marks)), el("span", "rp-tag", typeLabel(q.type)));
    const st = status[i];
    tags.append(el("span", "rp-chip rp-" + st.kind, st.text));
    card.append(tags);
    const key = keys[q.id] || {}, ans = answers[i] || {};
    if (q.type === "case_based") {
      card.append(latexBlock("pq-stem", q.questionLatex));
      const im = imageBox(q.imageUrl, "Figure for the question");
      if (im) card.append(im);
      (q.subQuestions || []).forEach((s, k) => {
        card.append(el("div", "rp-ans", "Sub-question " + (k + 1) + " \u00b7 " + typeLabel(s.type) + " \u00b7 " + marksText(s.marks)));
        card.append(reportPart(s.type, s, (key.subKeys || [])[k], (ans.subs || [])[k]));
      });
    } else {
      const part = reportPart(q.type, q, key, ans);
      const im = imageBox(q.imageUrl, "Figure for the question");
      if (im) part.insertBefore(im, part.children[q.type === "assertion_reason" ? 2 : 1] || null);
      card.append(part);
    }
    root.append(card);
  });
  return root;
}

/* ───────────────────────────── The practice app ───────────────────────────── */

export function initPractice(host, ctx) {
  /* A student may hold several access levels; each is one subject of one class. The
  "subject" key used by the screens below is the access level's ID. */
  const levelIds = ctx.levels || (ctx.level ? [ctx.level] : []);
  const infos = levelIds.map((l) => levelInfo(l)).filter(Boolean);
  const infoOf = (key) => infos.find((i) => i.level === key);
  const S = {
    chapters: {},           // subject -> chapter rows
    counts: {},             // chapter ID -> number of published questions
    filters: { difficulty: "", type: "" },
    subject: "", chapterId: "",
    session: null           // lives in this page only; never saved
  };
  let renderToken = 0;

  if (!infos.length) {
    host.append(el("div", "portal-error", "Your access level could not be recognised. Please contact the academy."));
    return;
  }

  function errorText(err) {
    return err && err.code === "permission-denied"
      ? "Permission was refused. Please contact the academy if this keeps happening."
      : "Something went wrong. Please check your connection and try again.";
  }
  function clear() { clearMath(host); host.textContent = ""; }
  function scrollTop() { try { window.scrollTo({ top: 0 }); } catch (e) { /* ignore */ } }

  /* ── Navigation (browser Back works between screens) ── */
  function go(view) {
    try { history.pushState({ pq: view }, ""); } catch (e) { /* ignore */ }
    show(view);
  }
  function show(view) {
    scrollTop();
    if (view.name === "chapters") return renderChapters(view.subject);
    if (view.name === "chapter") return renderChapter(view.subject, view.chapterId);
    if (view.name === "session") {
      if (S.session) return renderSession();
      return S.subject ? renderChapter(S.subject, S.chapterId) : renderHome();
    }
    return renderHome();
  }
  window.addEventListener("popstate", (e) => { show((e.state && e.state.pq) || { name: "home" }); });
  try { history.replaceState({ pq: { name: "home" } }, ""); } catch (e) { /* ignore */ }

  function backButton(label, onClick) {
    const b = el("button", "pq-back");
    b.type = "button";
    b.innerHTML = BACK_SVG;
    b.append(document.createTextNode(label));
    b.addEventListener("click", onClick);
    return b;
  }

  /* ── Home: subjects ── */
  function renderHome() {
    renderToken++;
    clear();
    host.append(el("h2", "pq-h2", "Practice Questions"));
    host.append(el("p", "portal-sub", "Practise a chapter and see your results at the end. Practice is not saved; you can download your result as a PDF."));
    const grid = el("div", "pq-grid");
    infos.forEach((inf) => {
      const b = el("button", "pq-tile");
      b.type = "button";
      b.append(el("strong", null, inf.subjectName), el("span", null, inf.label));
      b.insertAdjacentHTML("beforeend", ARROW_SVG);
      b.addEventListener("click", () => { S.subject = inf.level; go({ name: "chapters", subject: inf.level }); });
      grid.append(b);
    });
    host.append(grid);
  }

  /* ── Chapters of a subject ── */
  async function renderChapters(subject) {
    S.subject = subject;
    const token = ++renderToken;
    clear();
    host.append(backButton("All subjects", () => history.back()));
    host.append(el("h2", "pq-h2", infoOf(subject) ? infoOf(subject).subjectName : subject));
    const loading = el("div", "portal-loading", "Loading chapters…");
    loading.setAttribute("role", "status");
    host.append(loading);
    try {
      if (!S.chapters[subject]) S.chapters[subject] = await fetchChapters(infoOf(subject), infoOf(subject).subject);
    } catch (err) {
      console.error(err);
      if (token !== renderToken) return;
      loading.remove();
      host.append(el("div", "portal-error", errorText(err)));
      return;
    }
    if (token !== renderToken) return;
    loading.remove();
    const rows = S.chapters[subject];
    if (!rows.length) {
      host.append(el("div", "message-box", "No chapters have been added for this subject yet. Please check back soon."));
      return;
    }
    const list = el("div", "pq-list");
    rows.forEach((c) => {
      const b = el("button", "pq-row");
      b.type = "button";
      const main = el("div", "pq-row-main");
      main.append(el("strong", null, "Chapter " + c.chapterNumber + ": " + c.chapterName));
      const meta = el("span", "pq-row-meta", "Counting questions…");
      main.append(meta);
      b.append(main);
      b.insertAdjacentHTML("beforeend", ARROW_SVG);
      b.addEventListener("click", () => go({ name: "chapter", subject: subject, chapterId: c.id }));
      list.append(b);
      const showCount = (n) => {
        meta.textContent = n + (n === 1 ? " question" : " questions");
        if (n === 0) { b.disabled = true; meta.textContent = "No questions yet"; }
      };
      if (S.counts[c.id] != null) showCount(S.counts[c.id]);
      else {
        countPublished(subject, c.id).then((n) => { S.counts[c.id] = n; showCount(n); })
          .catch((err) => { console.error(err); meta.textContent = "Could not count questions"; });
      }
    });
    host.append(list);
  }

  /* ── Chapter: practice setup ── */
  async function renderChapter(subject, chapterId) {
    S.subject = subject; S.chapterId = chapterId;
    const token = ++renderToken;
    clear();
    host.append(backButton(infoOf(subject) ? infoOf(subject).subjectName : subject, () => history.back()));
    let ch = (S.chapters[subject] || []).find((c) => c.id === chapterId);
    if (!ch) {
      try {
        S.chapters[subject] = await fetchChapters(infoOf(subject), infoOf(subject).subject);
        ch = S.chapters[subject].find((c) => c.id === chapterId);
      } catch (err) {
        console.error(err);
        if (token !== renderToken) return;
        host.append(el("div", "portal-error", errorText(err)));
        return;
      }
    }
    if (token !== renderToken) return;
    if (!ch) { host.append(el("div", "message-box", "This chapter is no longer available.")); return; }

    host.append(el("h2", "pq-h2", "Chapter " + ch.chapterNumber + ": " + ch.chapterName));
    host.append(el("p", "portal-sub", "Answer the questions, then press Finish to see your results and the correct answers. Up to " + PRACTICE_MAX + " questions are given at a time, in question-number order."));

    const card = el("section", "portal-card");
    const fd = el("fieldset", "field");
    fd.append(el("legend", "field-label", "Difficulty"));
    const choices = el("div", "choices");
    [["", "All"]].concat(DIFFICULTIES.map((d) => [d, d])).forEach((p) => {
      const lab = el("label", "choice");
      const inp = el("input");
      inp.type = "radio"; inp.name = "pq-diff"; inp.value = p[0];
      inp.checked = S.filters.difficulty === p[0];
      inp.addEventListener("change", () => { S.filters.difficulty = p[0]; });
      lab.append(inp, el("span", null, p[1]));
      choices.append(lab);
    });
    fd.append(choices);
    card.append(fd);

    const tf = el("div", "field");
    const tl = el("label", "field-label", "Question type");
    tl.htmlFor = "pq-type";
    const sel = el("select", "input");
    sel.id = "pq-type";
    const o0 = el("option", null, "All types"); o0.value = ""; sel.append(o0);
    TYPES.forEach((t) => { const o = el("option", null, t.label); o.value = t.id; sel.append(o); });
    sel.value = S.filters.type;
    sel.addEventListener("change", () => { S.filters.type = sel.value; });
    tf.append(tl, sel);
    card.append(tf);

    const msg = el("div", "portal-error"); msg.hidden = true;
    const start = el("button", "btn btn-primary", "Start practice");
    start.type = "button";
    start.addEventListener("click", async () => {
      start.disabled = true; msg.hidden = true;
      try {
        const filters = { difficulty: S.filters.difficulty || null, type: S.filters.type || null };
        const got = await fetchSessionQuestions(subject, ch.id, filters);
        if (!got.rows.length) {
          msg.textContent = "No questions match these choices yet. Try different filters.";
          msg.hidden = false; start.disabled = false; return;
        }
        S.session = { chapter: ch, subject: subject, rows: got.rows, total: got.total, cards: got.rows.map(buildQuestion), idx: 0, shown: {}, results: null };
        go({ name: "session" });
      } catch (err) {
        console.error(err);
        msg.textContent = errorText(err); msg.hidden = false; start.disabled = false;
      }
    });
    card.append(msg, start);
    host.append(card);
  }

  /* ── Practice session: answer everything, then Finish ── */
  const paperOnly = (q) => isWritten(q.type) || (q.type === "case_based" && (q.subQuestions || []).every((s) => isWritten(s.type)));

  function renderSession() {
    const s = S.session;
    renderToken++;
    if (s.results) { renderResults(); return; }
    clear();
    host.append(backButton("Chapter " + s.chapter.chapterNumber, () => {
      if (window.confirm("Leave this practice? Your answers are not saved.")) { S.session = null; history.back(); }
    }));
    const head = el("div", "pq-sesshead");
    const headTitle = el("strong"); const headMeta = el("span", "pq-row-meta", s.chapter.chapterName);
    head.append(headTitle, headMeta);
    const qArea = el("div", "pt-qarea");
    const actions = el("div", "pq-actions pt-qacts");
    const prev = el("button", "btn btn-outline", "Previous"); prev.type = "button";
    const next = el("button", "btn btn-outline", "Next"); next.type = "button";
    actions.append(prev, next);
    const nav = el("section", "portal-card pt-nav");
    const msg = el("div", "portal-error"); msg.hidden = true;
    const finishBtn = el("button", "btn btn-primary", "Finish and see results"); finishBtn.type = "button";
    host.append(head, qArea, actions, nav, msg, finishBtn);

    const doneOf = (i) => !paperOnly(s.rows[i]) && s.cards[i].isComplete();

    function drawNav() {
      nav.textContent = "";
      nav.append(el("div", "pq-sublabel", "Questions"));
      const grid = el("div", "pt-grid");
      s.rows.forEach((q, i) => {
        const b = el("button", "pt-num", String(i + 1)); b.type = "button";
        if (i === s.idx) b.classList.add("is-current");
        if (doneOf(i)) b.classList.add("is-answered");
        if (paperOnly(q)) b.classList.add("is-paper");
        b.setAttribute("aria-label", "Question " + (i + 1) + (doneOf(i) ? ", answered" : ""));
        b.addEventListener("click", () => { s.idx = i; draw(); scrollTop(); });
        grid.append(b);
      });
      nav.append(grid);
      const legend = el("div", "pt-legend");
      [["Answered", "is-answered"], ["Model answer at the end", "is-paper"]].forEach((l) => {
        const k = el("span", "pt-key"); k.append(el("i", "pt-sw " + l[1]), document.createTextNode(l[0])); legend.append(k);
      });
      nav.append(legend);
    }

    function draw() {
      qArea.textContent = "";
      headTitle.textContent = "Question " + (s.idx + 1) + " of " + s.rows.length;
      qArea.append(s.cards[s.idx].root);
      if (!s.shown[s.idx]) { s.shown[s.idx] = true; typeset(s.cards[s.idx].root); }
      prev.disabled = s.idx === 0;
      next.disabled = s.idx === s.rows.length - 1;
      drawNav();
    }
    prev.addEventListener("click", () => { s.idx -= 1; draw(); scrollTop(); });
    next.addEventListener("click", () => { s.idx += 1; draw(); scrollTop(); });
    qArea.addEventListener("input", drawNav);
    qArea.addEventListener("change", drawNav);

    finishBtn.addEventListener("click", async () => {
      const open = s.rows.filter((q, i) => !paperOnly(q) && !s.cards[i].isComplete()).length;
      const text = (open ? "You have " + open + " unanswered " + (open === 1 ? "question" : "questions") + ". " : "") + "After finishing you cannot change your answers. Finish now?";
      if (!window.confirm(text)) return;
      finishBtn.disabled = true; msg.hidden = true;
      finishBtn.textContent = "Checking your answers…";
      try {
        const got = await fetchKeys(s.rows.map((q) => q.id));
        if (got.denied) {
          msg.textContent = "Answers are locked while a mock test is in progress. Finish or submit the test, then press Finish again. Your answers here are kept until you leave this page.";
          msg.hidden = false;
        } else {
          finalise(got.keys);
          scrollTop();
          renderResults();
          return;
        }
      } catch (err) {
        console.error(err);
        msg.textContent = errorText(err); msg.hidden = false;
      }
      finishBtn.disabled = false; finishBtn.textContent = "Finish and see results";
    });

    draw();
  }

  /* Marks every question once the keys are in. Nothing is saved anywhere. */
  function finalise(keys) {
    const s = S.session;
    const answers = s.cards.map((c) => c.getAnswer());
    const marks = s.rows.map((q, i) => markQuestion(q, keys[q.id], answers[i]));
    const sum = { correct: 0, wrong: 0, unanswered: 0, scored: 0 };
    const status = s.rows.map((q, i) => {
      const m = marks[i];
      if (!m.scored) return { kind: "paper", text: "Compare with model answer" };
      sum.scored += 1;
      if (q.type === "case_based") {
        const auto = m.subResults.filter((r) => r !== null);
        const good = auto.filter((r) => r === true).length;
        if (m.isCorrect) sum.correct += 1; else if (!good && !s.cards[i].isComplete()) sum.unanswered += 1; else sum.wrong += 1;
        return { kind: m.isCorrect ? "correct" : "wrong", text: good + " of " + auto.length + " parts correct" };
      }
      if (!s.cards[i].isComplete()) { sum.unanswered += 1; return { kind: "unanswered", text: "Not answered" }; }
      if (m.isCorrect) { sum.correct += 1; return { kind: "correct", text: "Correct" }; }
      sum.wrong += 1; return { kind: "wrong", text: "Incorrect" };
    });
    s.results = { keys: keys, answers: answers, marks: marks, status: status, summary: sum };
  }

  /* ── Results: summary, PDF, and every question with its answer and explanation ── */
  function renderResults() {
    const s = S.session;
    renderToken++;
    clear();
    host.append(backButton("Chapter " + s.chapter.chapterNumber, () => { S.session = null; history.back(); }));
    host.append(el("h2", "pq-h2", "Practice results"));
    host.append(el("p", "portal-sub", "Chapter " + s.chapter.chapterNumber + ": " + s.chapter.chapterName));
    const R = s.results, sm = R.summary;

    const sumCard = el("section", "portal-card pq-summary");
    const dl = el("dl", "summary-list");
    [["Questions", String(s.rows.length)],
      ["Correct (auto-marked)", sm.scored ? sm.correct + " / " + sm.scored + " (" + pct(sm.correct, sm.scored) + ")" : "–"],
      ["Correct · Wrong · Not answered", sm.correct + " · " + sm.wrong + " · " + sm.unanswered]
    ].forEach((p) => { const d = el("div"); d.append(el("dt", null, p[0]), el("dd", null, p[1])); dl.append(d); });
    sumCard.append(dl);
    sumCard.append(el("p", "field-hint", "Written answers are not marked here; compare them with the model answer. Practice is not saved: once you leave this page, this result is gone unless you download it."));

    const exp = el("div", "pt-export");
    const dlBtn = el("button", "btn btn-primary", "Download PDF"); dlBtn.type = "button";
    const shBtn = PDF.canShareFiles() ? el("button", "btn btn-secondary", "Share PDF") : null;
    if (shBtn) shBtn.type = "button";
    const expMsg = el("p", "field-hint pt-export-msg", ""); expMsg.setAttribute("role", "status");
    let pdfBlob = null, working = false;
    const inf = infoOf(s.subject);
    const pdfName = PDF.pdfFileName("Practice " + s.chapter.chapterName);
    async function makePdf() {
      if (pdfBlob) return pdfBlob;
      expMsg.textContent = "Preparing your PDF\u2026";
      const root = buildPracticeReport({
        chapter: s.chapter, subjectLabel: inf ? inf.label : "", rows: s.rows, answers: R.answers, keys: R.keys,
        marks: R.marks, status: R.status, summary: sm, student: { name: ctx.name, email: ctx.email }
      });
      document.body.appendChild(root);
      try {
        pdfBlob = await PDF.reportToPdf(root, (i, n) => { expMsg.textContent = "Preparing your PDF\u2026 " + i + " of " + n; });
      } finally { clearMath(root); root.remove(); }
      return pdfBlob;
    }
    async function runExport(share) {
      if (working) return;
      working = true; dlBtn.disabled = true; if (shBtn) shBtn.disabled = true;
      try {
        const blob = await makePdf();
        if (share) {
          try {
            const done = await PDF.shareBlob(blob, pdfName, "Practice result", "My practice result: " + s.chapter.chapterName);
            expMsg.textContent = done ? "" : "Sharing was cancelled. Your PDF is ready; press Share PDF again.";
          } catch (e) {
            console.error(e);
            expMsg.textContent = "Your PDF is ready. Press Share PDF once more to open the share sheet, or use Download PDF.";
          }
        } else {
          PDF.downloadBlob(blob, pdfName);
          expMsg.textContent = "Your PDF has been downloaded.";
        }
      } catch (e) {
        console.error(e);
        expMsg.textContent = "The PDF could not be made. Please check your connection and try again.";
      }
      working = false; dlBtn.disabled = false; if (shBtn) shBtn.disabled = false;
    }
    dlBtn.addEventListener("click", () => runExport(false));
    if (shBtn) shBtn.addEventListener("click", () => runExport(true));
    exp.append(dlBtn);
    if (shBtn) exp.append(shBtn);
    sumCard.append(exp, expMsg);
    host.append(sumCard);

    host.append(el("h3", "pq-h2 pq-gap pt-sub", "Review"));
    if (!s.reviewEls) {
      s.reviewEls = s.rows.map((q, i) => {
        const wrap = el("div", "pq-review");
        const st = R.status[i];
        const chipRow = el("div", "pq-tags");
        chipRow.append(el("span", "q-tag", "Question " + (i + 1)), el("span", "pt-chip " + (st.kind === "correct" ? "is-correct" : st.kind === "wrong" ? "is-wrong" : ""), st.text));
        wrap.append(chipRow);
        const card = s.cards[i];
        card.lock();
        card.reveal(R.keys[q.id] || {});
        wrap.append(card.root);
        const key = R.keys[q.id] || {};
        if ((key.explanationLatex || "").trim() || imageBox(key.explanationImageUrl, "x")) {
          const ex = el("div", "pq-explain");
          ex.append(el("div", "pq-sublabel", "Explanation"));
          if ((key.explanationLatex || "").trim()) ex.append(latexBlock("", key.explanationLatex));
          const im = imageBox(key.explanationImageUrl, "Figure for the explanation");
          if (im) ex.append(im);
          wrap.append(ex);
        }
        return wrap;
      });
    }
    s.reviewEls.forEach((w) => host.append(w));
    typeset(host);

    const row = el("div", "pq-actions");
    const again = el("button", "btn btn-primary", "Practise again");
    again.type = "button";
    again.addEventListener("click", () => { S.session = null; history.back(); });
    const home = el("button", "btn btn-secondary", "All subjects");
    home.type = "button";
    home.addEventListener("click", () => { S.session = null; go({ name: "home" }); });
    row.append(again, home);
    host.append(row);
  }

  renderHome();
}
