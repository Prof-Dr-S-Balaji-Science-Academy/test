/* ─────────────────────────────────────────────────────────────────────
 * test-ui.js  (ES module, student mock tests, Phase 7)
 * The paper list, the timed test, and the result and review screens.
 * Everything here is display; the real locks are Firestore Rules v8:
 *   - questions are served without answers
 *   - the answer keys stay unreadable until the test is submitted
 *   - the start time and the deadline come from the server, never from this
 *     device's clock (the clock below is only a display, corrected by the
 *     server time seen at the last save)
 * Only single choice, multiple choice and Assertion and Reason are answered
 * and marked on screen; every other type is written on paper (owner, 2026-10-09).
 * All text from the database is inserted with textContent.
 * ───────────────────────────────────────────────────────────────────── */
import { typeLabel } from "./question-core.js";
import * as P from "./paper-core.js";
import * as L from "./paper-logic.js";
import { el, typeset, clearMath, latexBlock, imageBox } from "./practice-ui.js";

const letter = (i) => String.fromCharCode(65 + i);
const marksText = (m) => m + (m === 1 ? " mark" : " marks");
const LOCK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const fmtWhen = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const AUTOSAVE_MS = 20000;

/* A small modal question box. Resolves true / false. */
function confirmBox(title, text, okLabel, cancelLabel) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "pt-dialog";
    d.append(el("h3", "pt-dlg-title", title), el("p", "pt-dlg-text", text));
    const row = el("div", "pq-actions");
    const ok = el("button", "btn btn-primary", okLabel); ok.type = "button";
    const no = el("button", "btn btn-outline", cancelLabel || "Cancel"); no.type = "button";
    row.append(ok, no); d.append(row);
    document.body.append(d);
    const done = (v) => { try { d.close(); } catch (e) { /* ignore */ } d.remove(); resolve(v); };
    ok.addEventListener("click", () => done(true));
    no.addEventListener("click", () => done(false));
    d.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
    if (typeof d.showModal === "function") d.showModal(); else { d.remove(); resolve(window.confirm(title + "\n\n" + text)); }
  });
}

/* ── Read-only rendering of question parts (types written on paper) ── */
function staticPart(type, item) {
  const root = el("div", "pq-part");
  root.append(latexBlock("pq-stem", item.questionLatex));
  if (type === "mcq_single" || type === "mcq_multi") {
    const wrap = el("div", "pq-opts");
    (item.options || []).forEach((t, i) => {
      const row = el("div", "pq-opt pt-opt-static");
      row.append(el("span", "pq-opt-l", letter(i)), latexBlock("pq-opt-t", t));
      wrap.append(row);
    });
    root.append(wrap);
  } else if (type === "match") {
    const cols = el("div", "pq-matchcols");
    const lc = el("div", "pq-matchcol"); lc.append(el("div", "pq-sublabel", "Column I"));
    const rc = el("div", "pq-matchcol"); rc.append(el("div", "pq-sublabel", "Column II"));
    (item.matchLeft || []).forEach((t, i) => { const r = el("div", "pq-matchrow"); r.append(el("span", "pq-opt-l", String(i + 1)), latexBlock("pq-opt-t", t)); lc.append(r); });
    (item.matchRight || []).forEach((t, i) => { const r = el("div", "pq-matchrow"); r.append(el("span", "pq-opt-l", letter(i)), latexBlock("pq-opt-t", t)); rc.append(r); });
    cols.append(lc, rc);
    root.append(cols);
  }
  return root;
}

function staticQuestion(q) {
  const root = el("div");
  if (q.type === "case_based") {
    root.append(el("div", "pq-sublabel", "Read the passage"), latexBlock("pq-stem", q.questionLatex));
    const im = imageBox(q.imageUrl, "Figure for the question");
    if (im) root.append(im);
    (q.subQuestions || []).forEach((s, i) => {
      const card = el("div", "pq-sub");
      card.append(el("div", "pq-subhead", "Sub-question " + (i + 1) + " · " + typeLabel(s.type) + " · " + marksText(s.marks)));
      card.append(staticPart(s.type, s));
      root.append(card);
    });
  } else {
    root.append(staticPart(q.type, q));
    const im = imageBox(q.imageUrl, "Figure for the question");
    if (im) root.insertBefore(im, root.firstChild.children[1] || null);
  }
  return root;
}

/* The question text of an on-screen (marked) question, without its options. */
function evaluatedStem(q) {
  const root = el("div");
  if (q.type === "assertion_reason") {
    const a = el("div", "pq-ar"); a.append(el("strong", null, "Assertion (A): "), latexBlock("pq-inline", q.assertionLatex));
    const r = el("div", "pq-ar"); r.append(el("strong", null, "Reason (R): "), latexBlock("pq-inline", q.reasonLatex));
    root.append(a, r);
    const im = imageBox(q.imageUrl, "Figure for the question");
    if (im) root.append(im);
  } else {
    root.append(latexBlock("pq-stem", q.questionLatex));
    const im = imageBox(q.imageUrl, "Figure for the question");
    if (im) root.append(im);
  }
  return root;
}

/* ── Answer key text for types written on paper ── */
function keyBlock(q, key) {
  const box = el("div", "pq-model");
  const lines = [];
  const one = (type, item, k, prefix) => {
    k = k || {};
    if (type === "true_false") lines.push(prefix + "Correct answer: " + (((k.correct || [])[0]) === 0 ? "True" : "False"));
    else if (type === "mcq_single" || type === "mcq_multi") lines.push(prefix + "Correct answer: " + (k.correct || []).map(letter).join(", "));
    else if (type === "fill_blank") lines.push(prefix + "Accepted answer: " + (k.acceptedAnswers || []).join(", "));
    else if (type === "numerical") lines.push(prefix + "Correct answer: " + (typeof k.numericAnswer === "number" ? k.numericAnswer : "") + (k.tolerance > 0 ? " (within ±" + k.tolerance + ")" : ""));
    else if (type === "match") lines.push(prefix + "Correct matches: " + (k.matchMap || []).map((m, i) => (i + 1) + " → " + letter(m)).join(", "));
  };
  if (q.type === "case_based") (q.subQuestions || []).forEach((s, i) => one(s.type, s, (key.subKeys || [])[i], "Sub-question " + (i + 1) + ": "));
  else one(q.type, q, key, "");
  if (lines.length) lines.forEach((t) => box.append(el("div", "pq-correct-line", t)));
  const models = [];
  if (q.type === "case_based") (key.subKeys || []).forEach((k, i) => { if (k && (k.modelAnswerLatex || "").trim()) models.push(["Sub-question " + (i + 1) + " model answer", k.modelAnswerLatex]); });
  else if ((key.modelAnswerLatex || "").trim()) models.push(["Model answer", key.modelAnswerLatex]);
  models.forEach((m) => { box.append(el("div", "pq-sublabel pt-gap-s", m[0]), latexBlock("", m[1])); });
  return box.children.length ? box : null;
}

function explanationBlock(key) {
  const has = (key.explanationLatex || "").trim();
  const im = imageBox(key.explanationImageUrl, "Figure for the explanation");
  if (!has && !im) return null;
  const ex = el("div", "pq-explain");
  ex.append(el("div", "pq-sublabel", "Explanation"));
  if (has) ex.append(latexBlock("", key.explanationLatex));
  if (im) ex.append(im);
  return ex;
}

/* ═══════════════════════════ The mock test app ═══════════════════════════ */

export function initTests(host, ctx) {
  const T = { papers: [], active: null, history: [], loaded: false };
  let token = 0;

  const errText = (err) => (err && err.code === "permission-denied"
    ? "Permission was refused. Please contact the academy if this keeps happening."
    : "Something went wrong. Please check your connection and try again.");
  function clear() { clearMath(host); host.textContent = ""; }
  const scrollTop = () => { try { window.scrollTo({ top: 0 }); } catch (e) { /* ignore */ } };
  const loadingBox = (t) => { const d = el("div", "portal-loading", t); d.setAttribute("role", "status"); return d; };

  /* ───────────────────────── Home: papers, resume, history ───────────────────────── */
  async function renderHome(message) {
    const my = ++token;
    ctx.setBusy(false);
    clear();
    host.append(el("h2", "pq-h2", "Mock tests"));
    if (message) host.append(el("div", "message-box", message));
    const load = loadingBox("Loading mock tests…");
    host.append(load);
    let err = null;
    try {
      const [papers, active, history] = await Promise.all([
        P.fetchPapersForLevel(ctx.level), P.fetchActiveSessions(ctx.uid), P.fetchSubmittedSessions(ctx.uid)
      ]);
      T.papers = papers; T.active = active[0] || null; T.history = history; T.loaded = true;
    } catch (e) { console.error(e); err = e; }
    if (my !== token) return;
    load.remove();
    if (err) { host.append(el("div", "portal-error", errText(err))); return; }

    if (T.active) {
      const handled = await handleActive(my);
      if (my !== token) return;
      if (handled === "gone") return;
    }

    if (T.active) {
      const card = el("section", "portal-card pt-resume");
      card.append(el("h3", "pa-h3", "Test in progress"));
      card.append(el("p", "portal-sub", T.active.paperTitle + " · " + L.clockText(T.activeLeft / 1000) + " left. The clock keeps running until you submit."));
      const b = el("button", "btn btn-primary", "Resume test"); b.type = "button";
      b.addEventListener("click", () => runTest(T.active, T.activeOffset, null));
      card.append(b);
      host.append(card);
    }

    host.append(el("h3", "pq-h2 pq-gap pt-sub", "Available papers"));
    if (!T.papers.length) host.append(el("div", "message-box", "No mock test papers are available for your class yet. Please check back soon."));
    else {
      const list = el("div", "pq-list");
      T.papers.forEach((p) => list.append(paperCard(p)));
      host.append(list);
    }

    if (T.history.length) {
      host.append(el("h3", "pq-h2 pq-gap pt-sub", "Your tests"));
      const list = el("div", "pq-list");
      T.history.slice(0, 20).forEach((s) => {
        const row = el("div", "pq-row pt-hist");
        const main = el("div", "pq-row-main");
        main.append(el("strong", null, s.paperTitle), el("span", "pq-row-meta", fmtWhen(s.startedAt) + (s.late ? " · Submitted after the time limit" : "")));
        const b = el("button", "btn btn-outline btn-sm", "View result"); b.type = "button";
        b.addEventListener("click", () => { scrollTop(); showResult(s, false, null); });
        row.append(main, b);
        list.append(row);
      });
      host.append(list);
    }
  }

  /* An unfinished session: finish it if its time is over, otherwise get ready to resume it. */
  async function handleActive(my) {
    const s = T.active;
    const local = readBackup(s.id);
    const answers = { ...(s.answers || {}), ...(local ? local.answers : {}) };
    const marked = local ? local.marked : (s.marked || []);
    let serverMs = null;
    try { serverMs = await P.saveProgress(s.id, answers, marked); } catch (e) { console.error(e); }
    if (my !== token) return "gone";
    if (serverMs === null) {
      /* The server no longer accepts changes: past the end and the grace period. Finalise as late. */
      try {
        const done = await P.submitSession(s, answers, marked, true);
        clearBackup(s.id);
        showResult(done, true, null);
        return "gone";
      } catch (e) { console.error(e); T.active = null; host.append(el("div", "portal-error", "An earlier test could not be closed. " + errText(e))); return "failed"; }
    }
    s.answers = answers; s.marked = marked;
    T.activeOffset = serverMs - Date.now();
    T.activeLeft = P.deadlineMs(s) - serverMs;
    if (T.activeLeft <= 0) {
      /* Time is up but still inside the grace period: submit what was saved. */
      try {
        const done = await P.submitSession(s, answers, marked, false);
        clearBackup(s.id);
        showResult(done, true, null);
        return "gone";
      } catch (e) { console.error(e); return "failed"; }
    }
    return "ok";
  }

  function paperCard(p) {
    const card = el("div", "pq-row pt-paper");
    const main = el("div", "pq-row-main");
    main.append(el("strong", null, p.title));
    if (p.description) main.append(el("span", "pt-desc", p.description));
    const bits = [p.count + (p.count === 1 ? " question" : " questions"), p.durationMin + " minutes"];
    if (p.negativeMarking > 0) bits.push("Negative marking");
    main.append(el("span", "pq-row-meta", bits.join(" · ")));
    const side = el("div", "pt-side");
    if (p.access === "public") {
      const b = el("button", "btn btn-primary btn-sm", "Start"); b.type = "button";
      b.disabled = !!T.active;
      b.addEventListener("click", () => startPaper(p, b));
      side.append(b);
      if (T.active) side.append(el("span", "pq-row-meta", "Finish your test in progress first"));
    } else {
      const l = el("span", "pt-locked"); l.insertAdjacentHTML("beforeend", LOCK_SVG); l.append(document.createTextNode("Locked"));
      side.append(l);
    }
    card.append(main, side);
    return card;
  }

  /* ───────────────────────── Starting a test ───────────────────────── */
  async function startPaper(paper, btn) {
    const ok = await confirmBox("Start this test?",
      "\"" + paper.title + "\" has " + paper.durationMin + " minutes. The clock starts now and keeps running even if you leave the page. Written answers go on paper.",
      "Start test", "Not now");
    if (!ok) return;
    btn.disabled = true;
    const status = el("div", "portal-loading", "Preparing your test…");
    btn.parentNode.append(status);
    function fail(text) { status.remove(); btn.disabled = false; host.insertBefore(el("div", "portal-error", text), host.children[1] || null); scrollTop(); }
    try {
      let order, rows;
      if (paper.mode === "fixed") {
        const map = await P.loadQuestions(paper.questionIds);
        if (paper.questionIds.some((id) => !map[id])) { fail("This paper has a question that is not available right now. Please tell the academy."); return; }
        rows = paper.questionIds.map((id) => map[id]);
        order = paper.shuffle ? L.shuffled(paper.questionIds) : paper.questionIds.slice();
      } else {
        const pool = await P.loadRulePool(ctx.level, paper.rules);
        const pick = L.pickRuleQuestions(pool, paper.rules.mix);
        if (!pick.ok) { fail("This paper cannot be made right now because it does not have enough questions. Please tell the academy."); return; }
        rows = pick.picked;
        order = L.shuffled(rows.map((q) => q.id));
      }
      const optionOrder = L.buildOptionOrder(rows, paper.shuffle);
      const session = await P.startSession(ctx.uid, paper, ctx.level, order, optionOrder);
      const qs = {};
      rows.forEach((q) => { qs[q.id] = q; });
      const offset = session.startedAt.toMillis() - Date.now();
      status.remove();
      runTest(session, offset, qs);
    } catch (err) {
      console.error(err);
      fail(err && err.code === "permission-denied"
        ? "The test could not be started. It may be locked, or you may already have a test in progress."
        : errText(err));
    }
  }

  /* ───────────────────────── Local backup (survives a closed tab) ───────────────────────── */
  const bkKey = (id) => "pbt-" + id;
  function readBackup(id) {
    try { const v = JSON.parse(localStorage.getItem(bkKey(id))); return v && v.answers ? v : null; } catch (e) { return null; }
  }
  function writeBackup(id, answers, marked) { try { localStorage.setItem(bkKey(id), JSON.stringify({ answers: answers, marked: marked })); } catch (e) { /* ignore */ } }
  function clearBackup(id) { try { localStorage.removeItem(bkKey(id)); } catch (e) { /* ignore */ } }

  /* ───────────────────────── The timed test ───────────────────────── */
  async function runTest(session, offset, qsGiven) {
    const my = ++token;
    ctx.setBusy(true);
    clear();
    scrollTop();
    host.append(loadingBox("Loading your test…"));
    let qs = qsGiven;
    if (!qs) {
      qs = await P.loadQuestions(session.questionIds);
      if (my !== token) return;
    }
    const order = session.questionIds;
    const local = readBackup(session.id);
    const answers = { ...(session.answers || {}), ...(local ? local.answers : {}) };
    const marked = new Set(local ? local.marked : (session.marked || []));
    const perm = session.optionOrder || {};
    const deadline = P.deadlineMs(session);
    const R = { idx: 0, dirty: false, saving: false, submitting: false, offset: offset, timer: null, saveTimer: null };
    const nowSrv = () => Date.now() + R.offset;

    clear();
    const bar = el("div", "pt-bar");
    const barTitle = el("div", "pt-bar-title");
    barTitle.append(el("strong", null, session.paperTitle));
    const saveState = el("span", "pq-row-meta", "");
    barTitle.append(saveState);
    const timerEl = el("div", "pt-timer"); timerEl.setAttribute("role", "timer");
    const submitBtn = el("button", "btn btn-primary btn-sm", "Submit test"); submitBtn.type = "button";
    bar.append(barTitle, timerEl, submitBtn);
    const qArea = el("div", "pt-qarea");
    const nav = el("section", "portal-card pt-nav");
    const msg = el("div", "portal-error"); msg.hidden = true;
    host.append(bar, msg, qArea, nav);

    const isAnswered = (id) => !!(answers[id] && answers[id].sel && answers[id].sel.length);
    const markedArr = () => Array.from(marked);

    /* — navigator — */
    function drawNav() {
      nav.textContent = "";
      nav.append(el("div", "pq-sublabel", "Questions"));
      const grid = el("div", "pt-grid");
      order.forEach((id, i) => {
        const q = qs[id];
        const b = el("button", "pt-num", String(i + 1)); b.type = "button";
        if (i === R.idx) b.classList.add("is-current");
        if (isAnswered(id)) b.classList.add("is-answered");
        if (marked.has(id)) b.classList.add("is-marked");
        if (q && !L.isEvaluated(q.type)) b.classList.add("is-paper");
        b.setAttribute("aria-label", "Question " + (i + 1) + (isAnswered(id) ? ", answered" : "") + (marked.has(id) ? ", marked for review" : ""));
        b.addEventListener("click", () => { R.idx = i; drawQuestion(); scrollTop(); });
        grid.append(b);
      });
      nav.append(grid);
      const legend = el("div", "pt-legend");
      [["Answered", "is-answered"], ["Marked for review", "is-marked"], ["Written on paper", "is-paper"]].forEach((l) => {
        const k = el("span", "pt-key"); k.append(el("i", "pt-sw " + l[1]), document.createTextNode(l[0])); legend.append(k);
      });
      nav.append(legend);
    }

    /* — one question — */
    function drawQuestion() {
      clearMath(qArea);
      qArea.textContent = "";
      const id = order[R.idx], q = qs[id];
      const card = el("div", "pq-card");
      const tags = el("div", "pq-tags");
      tags.append(el("span", "q-tag", "Question " + (R.idx + 1) + " of " + order.length));
      if (q) tags.append(el("span", "q-tag", marksText(q.marks)), el("span", "q-tag", typeLabel(q.type)));
      if (marked.has(id)) tags.append(el("span", "q-tag", "Marked for review"));
      card.append(tags);

      if (!q) {
        card.append(el("p", "pq-hint", "This question is no longer available. It will not count."));
      } else if (!L.isEvaluated(q.type)) {
        card.append(staticQuestion(q));
        card.append(el("div", "q-note pt-papernote", "Write your answer on paper. This question is not marked on screen."));
      } else {
        card.append(evaluatedStem(q));
        card.append(optionList(q, id));
      }
      qArea.append(card);

      const row = el("div", "pq-actions pt-qacts");
      const prev = el("button", "btn btn-outline", "Previous"); prev.type = "button"; prev.disabled = R.idx === 0;
      const next = el("button", "btn btn-outline", "Next"); next.type = "button"; next.disabled = R.idx === order.length - 1;
      const mark = el("button", "btn btn-outline", marked.has(id) ? "Remove review mark" : "Mark for review"); mark.type = "button";
      prev.addEventListener("click", () => { R.idx -= 1; drawQuestion(); scrollTop(); });
      next.addEventListener("click", () => { R.idx += 1; drawQuestion(); scrollTop(); });
      mark.addEventListener("click", () => { if (marked.has(id)) marked.delete(id); else marked.add(id); changed(); drawQuestion(); });
      row.append(prev, mark, next);
      qArea.append(row);
      drawNav();
      typeset(qArea);
    }

    function optionList(q, id) {
      const multi = q.type === "mcq_multi";
      const wrap = el("div", "pq-opts");
      if (multi) wrap.append(el("div", "pq-hint", "Select every correct option."));
      const name = "pt" + id;
      const cur = (answers[id] && answers[id].sel) || [];
      L.displayOptions(q, perm[id]).forEach((o, pos) => {
        const lab = el("label", "pq-opt");
        const inp = el("input");
        inp.type = multi ? "checkbox" : "radio"; inp.name = name; inp.value = String(o.orig);
        inp.checked = cur.indexOf(o.orig) !== -1;
        inp.addEventListener("change", () => {
          const picked = Array.from(wrap.querySelectorAll("input")).filter((x) => x.checked).map((x) => parseInt(x.value, 10)).sort((a, b) => a - b);
          if (picked.length) answers[id] = { sel: picked }; else delete answers[id];
          changed(); drawNav();
          clearBtn.hidden = !picked.length;
        });
        lab.append(inp, el("span", "pq-opt-l", letter(pos)), latexBlock("pq-opt-t", o.text));
        wrap.append(lab);
      });
      const clearBtn = el("button", "link-btn pt-clear", "Clear my answer"); clearBtn.type = "button";
      clearBtn.hidden = !cur.length;
      clearBtn.addEventListener("click", () => {
        delete answers[id];
        wrap.querySelectorAll("input").forEach((x) => { x.checked = false; });
        clearBtn.hidden = true; changed(); drawNav();
      });
      wrap.append(clearBtn);
      return wrap;
    }

    /* — saving — */
    function changed() {
      R.dirty = true;
      writeBackup(session.id, answers, markedArr());
      saveState.textContent = "Unsaved changes";
      if (!R.saveTimer) R.saveTimer = setTimeout(() => { R.saveTimer = null; flush(); }, AUTOSAVE_MS);
    }
    async function flush() {
      if (R.submitting || R.saving || !R.dirty) return;
      R.saving = true;
      const snapshot = JSON.stringify([answers, markedArr()]);
      saveState.textContent = "Saving…";
      try {
        const serverMs = await P.saveProgress(session.id, answers, markedArr());
        if (serverMs === null) { R.saving = false; finish(true); return; }
        R.offset = serverMs - Date.now();
        if (JSON.stringify([answers, markedArr()]) === snapshot) { R.dirty = false; saveState.textContent = "All answers saved"; }
        else saveState.textContent = "Unsaved changes";
      } catch (err) {
        console.error(err);
        saveState.textContent = "Not saved yet. Will try again.";
        if (!R.saveTimer) R.saveTimer = setTimeout(() => { R.saveTimer = null; flush(); }, AUTOSAVE_MS);
      }
      R.saving = false;
    }
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    function stopAll() {
      clearInterval(R.timer); clearTimeout(R.saveTimer); R.saveTimer = null;
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    }

    /* — clock — */
    function tick() {
      const left = deadline - nowSrv();
      timerEl.textContent = L.clockText(left / 1000);
      timerEl.classList.toggle("is-low", left <= 5 * 60000);
      if (left <= 0 && !R.submitting) finish(true);
    }

    /* — submit — */
    async function finish(auto) {
      if (R.submitting) return;
      R.submitting = true;
      submitBtn.disabled = true;
      clearTimeout(R.saveTimer);
      msg.hidden = true;
      saveState.textContent = auto ? "Time is up. Submitting…" : "Submitting…";
      try {
        const probablyLate = nowSrv() > deadline + P.graceMs();
        const done = await P.submitSession(session, answers, markedArr(), probablyLate);
        stopAll(); clearBackup(session.id);
        scrollTop();
        showResult(done, true, qs);
      } catch (err) {
        console.error(err);
        R.submitting = false; submitBtn.disabled = false;
        saveState.textContent = "";
        msg.textContent = "Your test could not be submitted. " + errText(err) + " Your answers are kept on this device. Press Submit test to try again.";
        msg.hidden = false;
      }
    }
    submitBtn.addEventListener("click", async () => {
      const evalIds = order.filter((id) => qs[id] && L.isEvaluated(qs[id].type));
      const done = evalIds.filter(isAnswered).length;
      const text = "You have answered " + done + " of " + evalIds.length + " on-screen " + (evalIds.length === 1 ? "question" : "questions") + (marked.size ? " and marked " + marked.size + " for review" : "") + ". You cannot change your answers after submitting.";
      const ok = await confirmBox("Submit the test?", text, "Submit", "Keep working");
      if (ok) finish(false);
    });

    R.timer = setInterval(tick, 1000);
    tick();
    saveState.textContent = "All answers saved";
    drawQuestion();
    if (R.submitting) return;
  }

  /* ───────────────────────── Result and review ───────────────────────── */
  async function showResult(session, fresh, qsGiven) {
    const my = ++token;
    ctx.setBusy(false);
    clear();
    host.append(loadingBox("Loading your result…"));
    const ids = session.questionIds;
    let qs = qsGiven;
    let paper = null;
    try {
      [qs, paper] = await Promise.all([qs || P.loadQuestions(ids), P.fetchPaperLive(session.paperId)]);
    } catch (e) { console.error(e); }
    if (my !== token) return;
    const showKeys = paper ? !!paper.showKeys : false;

    /* Keys: always needed for the marked questions; the rest only when the paper shows keys. */
    const need = ids.filter((id) => qs[id] && (L.isEvaluated(qs[id].type) || showKeys));
    const { keys, denied } = await P.loadKeys(need);
    if (my !== token) return;
    clear();
    host.append(el("button", "pq-back pt-backbtn", "Back to mock tests"));
    host.lastChild.type = "button";
    host.lastChild.addEventListener("click", () => { renderHome(); scrollTop(); });

    host.append(el("h2", "pq-h2", session.paperTitle));
    if (denied) {
      host.append(el("div", "message-box", "Your answers are saved, but the result cannot be shown while another test is in progress. Finish that test first, then open this result again."));
      return;
    }
    const answers = session.answers || {};
    const res = L.scoreSession(ids, qs, keys, answers, session.negativeMarking || 0);

    const sum = el("section", "portal-card pq-summary");
    const dl = el("dl", "summary-list");
    const addRow = (a, b) => { const d = el("div"); d.append(el("dt", null, a), el("dd", null, b)); dl.append(d); };
    addRow("Score (marked on screen)", res.evalMax > 0 ? res.score + " / " + res.evalMax : "–");
    addRow("Correct · Wrong · Not answered", res.correct + " · " + res.wrong + " · " + res.unanswered);
    if (res.selfCount) addRow("Written on paper", res.selfCount + (res.selfCount === 1 ? " question" : " questions") + " · " + marksText(res.selfMarks));
    sum.append(dl);
    if ((session.negativeMarking || 0) > 0) sum.append(el("p", "field-hint", "Negative marking applied: a wrong answer loses " + L.round2((session.negativeMarking || 0) * 100) + "% of that question's marks."));
    if (res.selfCount) sum.append(el("p", "field-hint", "Questions written on paper are not marked here. Compare them with the answer key if shown, or submit your answer sheet to your teacher."));
    if (session.late) sum.append(el("p", "field-hint", "This test was submitted after the time limit."));
    if (!showKeys) sum.append(el("p", "field-hint", "The answer key is not shown for this paper."));
    host.append(sum);

    host.append(el("h3", "pq-h2 pq-gap pt-sub", "Review"));
    const correctMap = {};
    ids.forEach((id, i) => {
      const q = qs[id], r = res.per[id];
      const card = el("div", "pq-card pt-review");
      const tags = el("div", "pq-tags");
      tags.append(el("span", "q-tag", "Question " + (i + 1)));
      if (q) tags.append(el("span", "q-tag", marksText(q.marks)), el("span", "q-tag", typeLabel(q.type)));
      const label = { correct: "Correct", wrong: "Incorrect", unanswered: "Not answered", paper: "Written on paper", missing: "Not available" }[r.status];
      const chip = el("span", "pt-chip " + (r.status === "correct" ? "is-correct" : r.status === "wrong" ? "is-wrong" : ""), label + (r.delta ? " (" + (r.delta > 0 ? "+" : "") + r.delta + ")" : ""));
      tags.append(chip);
      card.append(tags);
      if (!q) { card.append(el("p", "pq-hint", "This question is no longer available.")); host.append(card); return; }
      const key = keys[id] || {};
      if (L.isEvaluated(q.type)) {
        card.append(evaluatedStem(q));
        const a = answers[id] && answers[id].sel ? answers[id].sel : [];
        const wrap = el("div", "pq-opts");
        L.displayOptions(q, (session.optionOrder || {})[id]).forEach((o, pos) => {
          const lab = el("div", "pq-opt pt-opt-static");
          const isSel = a.indexOf(o.orig) !== -1;
          const isRight = (key.correct || []).indexOf(o.orig) !== -1;
          lab.append(el("span", "pq-opt-l", letter(pos)), latexBlock("pq-opt-t", o.text));
          if (showKeys && isRight) { lab.classList.add("is-correct"); lab.append(el("span", "pq-flag", isSel ? "Your answer (correct)" : "Correct answer")); }
          else if (isSel) { lab.classList.add(showKeys ? "is-wrong" : "is-chosen"); lab.append(el("span", "pq-flag", "Your answer")); }
          wrap.append(lab);
        });
        card.append(wrap);
        if (a.length) correctMap[id] = r.status === "correct";
      } else {
        card.append(staticQuestion(q));
        if (showKeys) { const kb = keyBlock(q, key); if (kb) card.append(kb); }
      }
      if (showKeys) { const ex = explanationBlock(key); if (ex) card.append(ex); }
      host.append(card);
    });
    typeset(host);

    if (fresh) {
      P.recordMockAttempts(ctx.uid, session, qs, answers, correctMap).catch((e) => console.error(e));
    }
  }

  renderHome();
}
