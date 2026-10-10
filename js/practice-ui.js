/* ─────────────────────────────────────────────────────────────────────
 * practice-ui.js  (ES module, student dashboard + practice mode, Phase 6)
 * Subject → chapter → practice, limited to the student's own access level.
 * Everything here is display; the real lock is Firestore Rules v8.
 * All text from the database is inserted with textContent (never as HTML)
 * and LaTeX is typeset by MathJax, which the dashboard page loads.
 * ───────────────────────────────────────────────────────────────────── */
import { typeLabel, TYPES, DIFFICULTIES } from "./question-core.js";
import {
  levelInfo, fetchChapters, countPublished, fetchPracticeQuestions, fetchKey, fetchStats,
  markQuestion, isWritten, recordAttempt
} from "./practice-core.js";

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

/* ───────────────────────────── The practice app ───────────────────────────── */

export function initPractice(host, ctx) {
  const info = levelInfo(ctx.level);
  const S = {
    stats: { chapters: {}, totals: { answered: 0, scored: 0, correct: 0 } },
    statsLoaded: false,
    chapters: {},           // subject -> chapter rows
    counts: {},             // chapter ID -> number of published questions
    filters: { difficulty: "", type: "" },
    session: null
  };
  let current = { name: "home" };
  let renderToken = 0;

  if (!info) {
    host.append(el("div", "portal-error", "Your access level could not be recognised. Please contact the academy."));
    return;
  }

  function errorText(err) {
    return err && err.code === "permission-denied"
      ? "Permission was refused. Please contact the academy if this keeps happening."
      : "Something went wrong. Please check your connection and try again.";
  }

  function clear() {
    clearMath(host);
    host.textContent = "";
  }

  function scrollTop() { try { window.scrollTo({ top: 0 }); } catch (e) { /* ignore */ } }

  /* ── Navigation (browser Back works between screens) ── */
  function go(view) {
    current = view;
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
  window.addEventListener("popstate", (e) => {
    const v = e.state && e.state.pq;
    current = v || { name: "home" };
    show(current);
  });
  try { history.replaceState({ pq: { name: "home" } }, ""); } catch (e) { /* ignore */ }

  function backButton(label, onClick) {
    const b = el("button", "pq-back");
    b.type = "button";
    b.innerHTML = BACK_SVG;
    b.append(document.createTextNode(label));
    b.addEventListener("click", onClick);
    return b;
  }

  async function ensureStats() {
    if (S.statsLoaded) return;
    try { S.stats = await fetchStats(ctx.uid); S.statsLoaded = true; } catch (e) { console.error(e); }
  }

  function chapterStats(id) {
    const c = S.stats.chapters[id] || {};
    return { answered: c.answered || 0, scored: c.scored || 0, correct: c.correct || 0 };
  }

  /* ── Home: summary and subjects ── */
  async function renderHome() {
    const token = ++renderToken;
    clear();
    const loading = el("div", "portal-loading", "Loading…");
    loading.setAttribute("role", "status");
    host.append(loading);
    await ensureStats();
    if (token !== renderToken) return;
    clear();

    const t = S.stats.totals;
    const sum = el("section", "portal-card pq-summary");
    sum.append(el("h2", "pq-h2", "Your practice"));
    const dl = el("dl", "summary-list");
    [["Questions answered", String(t.answered)], ["Correct (auto-marked)", pct(t.correct, t.scored)]].forEach((p) => {
      const d = el("div"); d.append(el("dt", null, p[0]), el("dd", null, p[1])); dl.append(d);
    });
    sum.append(dl);
    sum.append(el("p", "field-hint", "Written answers (very short, short and long) are self-assessed and are not part of the percentage."));
    host.append(sum);

    host.append(el("h2", "pq-h2 pq-gap", "Practice questions"));
    const grid = el("div", "pq-grid");
    info.subjects.forEach((s) => {
      const b = el("button", "pq-tile");
      b.type = "button";
      b.append(el("strong", null, s), el("span", null, info.label));
      b.insertAdjacentHTML("beforeend", ARROW_SVG);
      b.addEventListener("click", () => { S.subject = s; go({ name: "chapters", subject: s }); });
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
    host.append(el("h2", "pq-h2", subject));
    const loading = el("div", "portal-loading", "Loading chapters…");
    loading.setAttribute("role", "status");
    host.append(loading);
    await ensureStats();
    try {
      if (!S.chapters[subject]) S.chapters[subject] = await fetchChapters(info, subject);
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
      const st = chapterStats(c.id);
      const meta = el("span", "pq-row-meta", "Counting questions…");
      main.append(meta);
      b.append(main);
      b.insertAdjacentHTML("beforeend", ARROW_SVG);
      b.addEventListener("click", () => go({ name: "chapter", subject: subject, chapterId: c.id }));
      list.append(b);
      const show = (n) => {
        const bits = [n + (n === 1 ? " question" : " questions")];
        if (st.answered) bits.push(st.answered + " answered", pct(st.correct, st.scored) + " correct");
        meta.textContent = bits.join(" · ");
        if (n === 0) { b.disabled = true; meta.textContent = "No questions yet"; }
      };
      if (S.counts[c.id] != null) show(S.counts[c.id]);
      else {
        countPublished(ctx.level, c.id).then((n) => { S.counts[c.id] = n; show(n); })
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
    host.append(backButton(subject, () => history.back()));
    let ch = (S.chapters[subject] || []).find((c) => c.id === chapterId);
    if (!ch) {
      try {
        S.chapters[subject] = await fetchChapters(info, subject);
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
    await ensureStats();
    if (token !== renderToken) return;

    host.append(el("h2", "pq-h2", "Chapter " + ch.chapterNumber + ": " + ch.chapterName));
    const st = chapterStats(ch.id);
    host.append(el("p", "portal-sub",
      st.answered ? (st.answered + " answered · " + pct(st.correct, st.scored) + " correct (auto-marked)") : "You have not answered any question in this chapter yet."));

    const card = el("section", "portal-card");
    const fd = el("fieldset", "field");
    fd.append(el("legend", "field-label", "Difficulty"));
    const choices = el("div", "choices");
    [["", "All"]].concat(DIFFICULTIES.map((d) => [d, d])).forEach((p, i) => {
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
        const [total, first] = await Promise.all([
          countPublished(ctx.level, ch.id, filters),
          fetchPracticeQuestions(ctx.level, ch.id, filters, null)
        ]);
        if (!first.rows.length) {
          msg.textContent = "No questions match these choices yet. Try different filters.";
          msg.hidden = false; start.disabled = false; return;
        }
        S.session = {
          chapter: ch, filters: filters, rows: first.rows, cursor: first.cursor, done: first.done,
          total: Math.max(total, first.rows.length), index: 0, answered: 0, correct: 0, scored: 0, finished: false
        };
        go({ name: "session" });
      } catch (err) {
        console.error(err);
        msg.textContent = errorText(err); msg.hidden = false; start.disabled = false;
      }
    });
    card.append(msg, start);
    host.append(card);
  }

  /* ── Practice session ── */
  function renderSession() {
    const s = S.session;
    renderToken++;
    clear();
    host.append(backButton("Chapter " + s.chapter.chapterNumber, () => { S.session = null; history.back(); }));

    if (s.finished) { renderFinished(); return; }

    const q = s.rows[s.index];
    const head = el("div", "pq-sesshead");
    head.append(el("strong", null, "Question " + (s.index + 1) + " of " + s.total),
      el("span", "pq-row-meta", s.chapter.chapterName));
    host.append(head);

    const card = buildQuestion(q);
    host.append(card.root);
    const startedAt = Date.now();

    const feedback = el("div", "pq-feedback"); feedback.hidden = true;
    const actions = el("div", "pq-actions");
    const writtenWhole = isWritten(q.type);
    const check = el("button", "btn btn-primary", writtenWhole ? "Show model answer" : "Check answer");
    check.type = "button";
    check.disabled = !card.isComplete();
    const skip = el("button", "btn btn-secondary", "Skip");
    skip.type = "button";
    actions.append(check, skip);
    host.append(actions, feedback);

    card.root.addEventListener("input", () => { check.disabled = !card.isComplete(); });
    card.root.addEventListener("change", () => { check.disabled = !card.isComplete(); });
    skip.addEventListener("click", () => advance());

    const note = el("div", "portal-error"); note.hidden = true;
    host.insertBefore(note, feedback);

    check.addEventListener("click", async () => {
      check.disabled = true; skip.disabled = true; note.hidden = true;
      const seconds = (Date.now() - startedAt) / 1000;
      const answer = card.getAnswer();
      let key;
      try { key = await fetchKey(q.id); }
      catch (err) {
        console.error(err);
        note.textContent = (err && err.code === "permission-denied")
          ? "Answers are locked while a mock test is in progress. Finish or submit the test, then try again."
          : errorText(err);
        note.hidden = false;
        check.disabled = !card.isComplete(); skip.disabled = false;
        return;
      }
      const marked = markQuestion(q, key, answer);
      card.lock();
      card.reveal(key);
      actions.hidden = true;
      showFeedback(q, key, marked);

      if (writtenWhole) {
        const ask = el("div", "pq-self");
        ask.append(el("p", "pq-hint", "How did your answer compare with the model answer?"));
        const row = el("div", "pq-actions");
        const yes = el("button", "btn btn-primary", "I got it right");
        const no = el("button", "btn btn-secondary", "I need more practice");
        yes.type = no.type = "button";
        row.append(yes, no);
        ask.append(row);
        feedback.append(ask);
        const save = (right) => { yes.disabled = no.disabled = true; persist(q, answer, marked, seconds, right, ask); };
        yes.addEventListener("click", () => save(true));
        no.addEventListener("click", () => save(false));
      } else {
        persist(q, answer, marked, seconds, undefined, feedback);
      }
      typeset(host);
    });

    function showFeedback(qq, key, marked) {
      feedback.hidden = false;
      const banner = el("div", "pq-banner");
      if (!marked.scored) {
        banner.textContent = "Compare your answer with the model answer.";
      } else if (qq.type === "case_based") {
        const auto = marked.subResults.filter((r) => r !== null);
        const good = auto.filter((r) => r === true).length;
        banner.textContent = good + " of " + auto.length + " auto-marked " + (auto.length === 1 ? "part" : "parts") + " correct";
        banner.classList.add(marked.isCorrect ? "is-correct" : "is-wrong");
      } else {
        banner.textContent = marked.isCorrect ? "Correct" : "Incorrect";
        banner.classList.add(marked.isCorrect ? "is-correct" : "is-wrong");
      }
      feedback.append(banner);
      if ((key.explanationLatex || "").trim() || imageBox(key.explanationImageUrl, "x")) {
        const ex = el("div", "pq-explain");
        ex.append(el("div", "pq-sublabel", "Explanation"));
        if ((key.explanationLatex || "").trim()) ex.append(latexBlock("", key.explanationLatex));
        const im = imageBox(key.explanationImageUrl, "Figure for the explanation");
        if (im) ex.append(im);
        feedback.append(ex);
      }
    }

    /* Saves the attempt once; on failure the student can try saving again. */
    async function persist(qq, answer, marked, seconds, selfRight, box) {
      const status = el("div", "pq-savestate");
      box.append(status);
      async function attempt() {
        status.textContent = "Saving…";
        try {
          await recordAttempt(ctx.uid, qq, answer, marked, seconds, selfRight);
        } catch (err) {
          console.error(err);
          status.textContent = "";
          status.append(document.createTextNode(errorText(err) + " Your answer has not been saved. "));
          const retry = el("button", "link-btn", "Try saving again");
          retry.type = "button";
          retry.addEventListener("click", attempt);
          status.append(retry);
          return;
        }
        status.remove();
        const c = S.stats.chapters[qq.chapterId] = S.stats.chapters[qq.chapterId] || {};
        c.answered = (c.answered || 0) + 1;
        if (marked.scored) { c.scored = (c.scored || 0) + 1; if (marked.isCorrect) c.correct = (c.correct || 0) + 1; }
        S.stats.totals.answered += 1;
        if (marked.scored) { S.stats.totals.scored += 1; if (marked.isCorrect) S.stats.totals.correct += 1; }
        s.answered += 1;
        if (marked.scored) { s.scored += 1; if (marked.isCorrect) s.correct += 1; }
        const next = el("button", "btn btn-primary", s.index + 1 >= s.total ? "Finish" : "Next question");
        next.type = "button";
        next.addEventListener("click", () => advance());
        const row = el("div", "pq-actions");
        row.append(next);
        feedback.append(row);
      }
      attempt();
    }

    typeset(host);
  }

  async function advance() {
    const s = S.session;
    if (s.index + 1 >= s.rows.length && !s.done) {
      try {
        const more = await fetchPracticeQuestions(ctx.level, s.chapter.id, s.filters, s.cursor);
        s.rows = s.rows.concat(more.rows);
        s.cursor = more.cursor || s.cursor;
        s.done = more.done;
        s.total = Math.max(s.total, s.rows.length);
      } catch (err) {
        console.error(err);
        host.append(el("div", "portal-error", errorText(err)));
        return;
      }
    }
    if (s.index + 1 >= s.rows.length) s.finished = true;
    else s.index += 1;
    scrollTop();
    renderSession();
  }

  function renderFinished() {
    const s = S.session;
    host.append(el("h2", "pq-h2", "Practice complete"));
    const card = el("section", "portal-card");
    const dl = el("dl", "summary-list");
    [["Questions answered", String(s.answered)], ["Correct (auto-marked)", pct(s.correct, s.scored)]].forEach((p) => {
      const d = el("div"); d.append(el("dt", null, p[0]), el("dd", null, p[1])); dl.append(d);
    });
    card.append(dl);
    const row = el("div", "pq-actions");
    const again = el("button", "btn btn-primary", "Practise again");
    again.type = "button";
    again.addEventListener("click", () => { S.session = null; history.back(); });
    const home = el("button", "btn btn-secondary", "All subjects");
    home.type = "button";
    home.addEventListener("click", () => { S.session = null; S.statsLoaded = true; go({ name: "home" }); });
    row.append(again, home);
    card.append(row);
    host.append(card);
  }

  renderHome();
}
