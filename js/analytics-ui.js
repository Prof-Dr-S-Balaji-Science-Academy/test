/* ─────────────────────────────────────────────────────────────────────
 * analytics-ui.js  (ES module, ProfAdmin "Analytics" section, Phase 8)
 * Question-level results by chapter, subject and paper, with sorting,
 * filters and CSV export. No student name, email or ID is ever shown or
 * exported (L-18). Nothing is read from Firestore until ProfAdmin presses
 * Update; see analytics-core.js. All text is inserted with textContent.
 * ───────────────────────────────────────────────────────────────────── */
import * as Q from "./question-core.js";
import * as P from "./paper-core.js";
import * as C from "./analytics-core.js";
import * as L from "./analytics-logic.js";
import { typeset, clearMath, latexBlock } from "./practice-ui.js";

const SHOW_STEP = 100;

export function initAnalytics(host, api) {
  const el = api.el;
  const S = {
    ready: false, busy: false, progress: "",
    rows: [], info: { updatedAt: 0, count: 0 },
    mode: "all", view: "chapter",
    scopeKey: "", chapterId: "", paperId: "",
    chapters: {}, papers: [], papersLoaded: false,
    sort: "id", fDiff: "all", fType: "all", fFlag: false,
    shown: SHOW_STEP, loadingMeta: false
  };
  let token = 0;
  let uid = 0;

  const scopes = [];
  Q.FOLDERS.forEach((f) => f.subjects.forEach((s) => scopes.push({
    key: f.board + "|" + f.cls + "|" + s, board: f.board, cls: f.cls, subject: s, label: f.label + " · " + s
  })));
  const scopeOf = (key) => scopes.find((s) => s.key === key) || null;
  const typeLabel = (id) => { const t = Q.TYPES.find((x) => x.id === id); return t ? t.label : id; };
  const fmtWhen = (ms) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

  function field(label, control) {
    const w = el("div", "field");
    const id = "an" + (++uid);
    const l = el("label", "field-label", label);
    l.htmlFor = id; control.id = id;
    w.append(l, control);
    return w;
  }
  function select(items, value, onChange) {
    const s = el("select", "input");
    items.forEach((it) => { const o = el("option", null, it.label); o.value = it.value; if (it.value === value) o.selected = true; s.append(o); });
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  const btn = (label, cls, fn) => { const b = el("button", "btn " + cls + " btn-sm", label); b.type = "button"; b.addEventListener("click", fn); return b; };

  /* ───────────────────────── Data ───────────────────────── */
  function currentFilter() {
    const f = { mode: S.view === "paper" ? "mock" : S.mode };
    const sc = scopeOf(S.scopeKey);
    if (S.view !== "paper" && sc) { f.board = sc.board; f.cls = sc.cls; f.subject = sc.subject; }
    if (S.view === "chapter") f.chapterId = S.chapterId || "__none__";
    if (S.view === "paper") f.paperId = S.paperId || "__none__";
    return f;
  }

  async function loadChapters(key) {
    const sc = scopeOf(key);
    if (!sc || S.chapters[key]) return;
    try { S.chapters[key] = await Q.fetchChapters(sc.board, sc.cls, sc.subject); }
    catch (err) { console.error(err); api.notice("Chapters could not be loaded. " + api.failText(err), true); S.chapters[key] = []; }
  }

  async function loadPapers() {
    if (S.papersLoaded) return;
    try { S.papers = await P.listPapers(); S.papersLoaded = true; }
    catch (err) { console.error(err); api.notice("Papers could not be loaded. " + api.failText(err), true); }
  }

  async function runUpdate(rebuild) {
    if (S.busy) return;
    S.busy = true; S.progress = "Reading…"; api.notice(""); render();
    try {
      const res = rebuild
        ? await C.rebuildAttempts((n) => setProgress(n))
        : await C.updateAttempts((n) => setProgress(n));
      S.rows = C.getAttemptRows(); S.info = C.getInfo();
      api.notice((res.added ? res.added + " new attempt" + (res.added === 1 ? "" : "s") + " read. " : "Already up to date. ")
        + (res.caughtUp ? "" : "More attempts are waiting; press Update again to continue."));
    } catch (err) {
      console.error(err);
      S.rows = C.getAttemptRows(); S.info = C.getInfo();
      api.notice("Update stopped. " + api.failText(err) + " Attempts read before the problem are kept.", true);
    }
    S.busy = false; S.progress = ""; render();
  }
  function setProgress(n) {
    S.progress = "Reading… " + n + " attempts so far";
    const p = host.querySelector(".an-progress");
    if (p) p.textContent = S.progress;
  }

  async function start() {
    render();
    await C.init();
    S.rows = C.getAttemptRows(); S.info = C.getInfo(); S.ready = true;
    render();
  }

  /* ───────────────────────── Screen frame ───────────────────────── */
  function render() {
    token++;
    clearMath(host);
    host.textContent = "";

    const head = el("div", "admin-head");
    const t = el("div");
    t.append(el("h2", null, "Analytics"),
      el("p", null, "How students did on each question. Results are anonymous: no student names, emails or IDs are shown or exported."));
    const btns = el("div", "q-headbtns");
    const up = btn(S.busy ? "Updating…" : "Update", "btn-primary", () => runUpdate(false));
    up.disabled = S.busy || !S.ready;
    const rb = btn("Rebuild", "btn-outline", rebuildAsk);
    rb.disabled = S.busy || !S.ready;
    btns.append(up, rb);
    head.append(t, btns);
    host.append(head);

    if (!S.ready) { host.append(el("div", "portal-loading", "Loading…")); return; }

    const st = el("div", "an-status");
    const line = S.info.updatedAt
      ? S.info.count + " attempts saved in this browser. Last update " + fmtWhen(S.info.updatedAt) + "."
      : "No attempts loaded yet. Press Update to read them.";
    st.append(el("span", null, line));
    if (S.busy) st.append(el("span", "an-progress", S.progress));
    host.append(st);
    host.append(el("p", "field-hint an-note",
      "Update reads only the attempts added since the last update, so each attempt is read from the database once. The saved copy has no student identity."));

    host.append(controls());
    const body = el("div", "an-body");
    host.append(body);
    renderBody(body);
  }

  async function rebuildAsk() {
    const ok = await api.confirmDialog({
      title: "Rebuild from the database?",
      text: "This clears the copy saved in this browser and reads every attempt again, one database read each. Use it after deleting students, because their attempts stay in the saved copy until you rebuild.",
      ok: "Rebuild"
    });
    if (ok) runUpdate(true);
  }

  function controls() {
    const box = el("div", "an-controls");
    box.append(field("View", select([
      { value: "chapter", label: "By chapter" }, { value: "subject", label: "By subject" }, { value: "paper", label: "By paper" }
    ], S.view, async (v) => {
      S.view = v; S.shown = SHOW_STEP; api.notice("");
      if (v === "paper") { render(); await loadPapers(); render(); return; }
      render();
    })));
    if (S.view !== "paper") {
      box.append(field("Source", select([
        { value: "all", label: "Practice and mock tests" }, { value: "practice", label: "Practice only" }, { value: "mock", label: "Mock tests only" }
      ], S.mode, (v) => { S.mode = v; S.shown = SHOW_STEP; render(); })));
      const items = [{ value: "", label: "Choose a subject" }].concat(scopes.map((s) => ({ value: s.key, label: s.label })));
      box.append(field("Subject", select(items, S.scopeKey, async (v) => {
        S.scopeKey = v; S.chapterId = ""; S.shown = SHOW_STEP;
        if (v) { render(); await loadChapters(v); }
        render();
      })));
      if (S.view === "chapter" && S.scopeKey) {
        const chs = S.chapters[S.scopeKey];
        const ci = [{ value: "", label: chs ? "Choose a chapter" : "Loading chapters…" }];
        (chs || []).forEach((c) => ci.push({ value: c.id, label: "Chapter " + c.chapterNumber + " · " + c.chapterName }));
        box.append(field("Chapter", select(ci, S.chapterId, (v) => { S.chapterId = v; S.shown = SHOW_STEP; render(); })));
      }
    } else {
      const items = [{ value: "", label: S.papersLoaded ? "Choose a paper" : "Loading papers…" }];
      S.papers.forEach((p) => items.push({ value: p.id, label: p.title }));
      box.append(field("Paper", select(items, S.paperId, (v) => { S.paperId = v; S.shown = SHOW_STEP; render(); })));
    }
    return box;
  }

  /* ───────────────────────── Body ───────────────────────── */
  function empty(text) { return el("div", "message-box", text); }

  function renderBody(body) {
    if (!S.info.count) { body.append(empty("There are no saved attempts yet. Press Update to read the attempts students have made.")); return; }
    if (S.view === "subject") {
      if (!S.scopeKey) { body.append(empty("Choose a subject to see its chapters.")); return; }
      return renderSubject(body);
    }
    if (S.view === "chapter") {
      if (!S.scopeKey) { body.append(empty("Choose a subject, then a chapter.")); return; }
      if (!S.chapterId) { body.append(empty("Choose a chapter to see its questions.")); return; }
    } else if (!S.paperId) {
      body.append(empty(S.papersLoaded && !S.papers.length ? "There are no papers yet." : "Choose a paper to see its questions.")); return;
    }
    renderQuestions(body);
  }

  /* ── Subject: one line per chapter ── */
  function renderSubject(body) {
    const rows = L.filterRows(S.rows, currentFilter());
    if (!rows.length) { body.append(empty("No attempts for this subject with this source yet.")); return; }
    const chs = S.chapters[S.scopeKey];
    if (!chs) { body.append(el("div", "portal-loading", "Loading chapters…")); loadChapters(S.scopeKey).then(render); return; }
    const aggs = L.aggregate(rows);
    const roll = L.rollupByChapter(aggs);
    const byId = new Map(roll.map((r) => [r.c, r]));
    const ordered = [];
    chs.forEach((c) => { const r = byId.get(c.id); if (r) ordered.push({ r: r, title: "Chapter " + c.chapterNumber + " · " + c.chapterName, id: c.id }); byId.delete(c.id); });
    byId.forEach((r) => ordered.push({ r: r, title: "Removed chapter", id: "" }));

    body.append(tiles(L.overall(aggs), L.overall(aggs).questions, false));
    const tools = el("div", "an-tools");
    tools.append(btn("Export CSV", "btn-outline", () => exportCsv(
      ["Chapter", "Questions attempted", "Attempts", "Scored attempts", "Correct %", "Average time (practice)"],
      ordered.map((o) => [o.title, o.r.questions, o.r.attempts, o.r.scored, o.r.pct === null ? "" : o.r.pct, o.r.avgSecs === null ? "" : Math.round(o.r.avgSecs)]),
      "subject-" + (scopeOf(S.scopeKey).subject))));
    body.append(tools);

    const list = el("div", "a-list");
    ordered.forEach((o) => {
      const row = el("div", "an-row");
      const main = el("div", "an-main");
      main.append(el("div", "a-name", o.title));
      main.append(metrics([
        ["Questions", String(o.r.questions)], ["Attempts", String(o.r.attempts)],
        ["Correct", L.fmtPct(o.r.pct)], ["Avg time", L.fmtSecs(o.r.avgSecs)]
      ]));
      row.append(main);
      if (o.id) {
        const acts = el("div", "q-qacts");
        acts.append(btn("Open", "btn-outline", () => { S.view = "chapter"; S.chapterId = o.id; S.shown = SHOW_STEP; render(); }));
        row.append(acts);
      }
      list.append(row);
    });
    body.append(list);
  }

  /* ── Chapter and paper: one line per question ── */
  async function renderQuestions(body) {
    const my = token;
    const rows = L.filterRows(S.rows, currentFilter());
    if (!rows.length) {
      body.append(empty(S.view === "paper"
        ? "No attempts saved for this paper. Attempts made before Rules v8 was published do not record their paper, so they appear only in the chapter and subject views."
        : "No attempts for this chapter with this source yet."));
      return;
    }
    const aggs = L.aggregate(rows);
    const need = aggs.map((a) => a.q).filter((id) => !C.hasQuestion(id));
    if (need.length) {
      body.append(el("div", "portal-loading", "Loading details of " + need.length + " question" + (need.length === 1 ? "" : "s") + " (read once, then saved in this browser)…"));
      try { await C.loadQuestions(need, false); }
      catch (err) { console.error(err); if (my === token) api.notice("Question details could not be loaded. " + api.failText(err), true); }
      if (my !== token) return;
      body.textContent = "";
    }
    const view = aggs.map((a) => {
      const m = C.getQuestion(a.q);
      const diff = m && !m.missing && m.difficulty ? m.difficulty : a.diff;
      return { a: a, m: m, diff: diff, flag: L.difficultyFlag(diff, a.pct, a.scored), name: m && m.displayId ? m.displayId : a.q };
    });

    const ov = L.overall(aggs);
    body.append(tiles(ov, ov.questions, true, view.filter((v) => v.flag).length, S.view === "paper" ? L.countSessions(rows) : null));

    /* sorting and filters */
    const bar = el("div", "an-controls an-listctl");
    bar.append(field("Sort by", select([
      { value: "id", label: "Question number" }, { value: "attempts", label: "Most attempts" },
      { value: "low", label: "Lowest % correct" }, { value: "high", label: "Highest % correct" },
      { value: "time", label: "Longest average time" }, { value: "flag", label: "Flagged first" }
    ], S.sort, (v) => { S.sort = v; S.shown = SHOW_STEP; render(); })));
    bar.append(field("Difficulty", select([{ value: "all", label: "All" }].concat(Q.DIFFICULTIES.map((d) => ({ value: d, label: d }))),
      S.fDiff, (v) => { S.fDiff = v; S.shown = SHOW_STEP; render(); })));
    bar.append(field("Type", select([{ value: "all", label: "All types" }].concat(Q.TYPES.map((t) => ({ value: t.id, label: t.label }))),
      S.fType, (v) => { S.fType = v; S.shown = SHOW_STEP; render(); })));
    const flagLab = el("label", "pa-check");
    const cb = el("input"); cb.type = "checkbox"; cb.className = "check"; cb.checked = S.fFlag;
    cb.addEventListener("change", () => { S.fFlag = cb.checked; S.shown = SHOW_STEP; render(); });
    flagLab.append(cb, el("span", null, "Flagged only"));
    bar.append(flagLab);
    body.append(bar);

    let list = view.filter((v) => (S.fDiff === "all" || v.diff === S.fDiff) && (S.fType === "all" || v.a.type === S.fType) && (!S.fFlag || v.flag));
    const num = (x, d) => (x === null || x === undefined ? d : x);
    const cmp = {
      id: (x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }),
      attempts: (x, y) => y.a.attempts - x.a.attempts,
      low: (x, y) => num(x.a.pct, 101) - num(y.a.pct, 101),
      high: (x, y) => num(y.a.pct, -1) - num(x.a.pct, -1),
      time: (x, y) => num(y.a.avgSecs, -1) - num(x.a.avgSecs, -1),
      flag: (x, y) => (y.flag ? 1 : 0) - (x.flag ? 1 : 0) || x.name.localeCompare(y.name, undefined, { numeric: true })
    }[S.sort];
    list = list.slice().sort(cmp);

    const tools = el("div", "an-tools");
    tools.append(el("span", "field-hint", list.length + " of " + view.length + " questions"));
    const acts = el("div", "q-qacts");
    acts.append(btn("Refresh question details", "btn-outline", async () => {
      api.notice("Reading question details…");
      try { const n = await C.loadQuestions(aggs.map((a) => a.q), true); api.notice(n + " question detail" + (n === 1 ? "" : "s") + " refreshed."); }
      catch (err) { console.error(err); api.notice("Refresh failed. " + api.failText(err), true); }
      render();
    }));
    acts.append(btn("Export CSV", "btn-outline", () => exportCsv(
      ["Question ID", "Type", "Tagged difficulty", "Marks", "Attempts", "Scored attempts", "Correct %", "Average time (practice)", "Most chosen wrong option", "Difficulty flag"],
      list.map((v) => [v.name, typeLabel(v.a.type), v.diff, v.m && v.m.marks !== undefined ? v.m.marks : "", v.a.attempts, v.a.scored,
        v.a.pct === null ? "" : v.a.pct, v.a.avgSecs === null ? "" : Math.round(v.a.avgSecs),
        v.a.topWrong ? L.optionLabel(v.a.type, v.a.topWrong.idx) : "", v.flag ? v.flag.short : ""]),
      S.view === "paper" ? "paper" : "chapter")));
    tools.append(acts);
    body.append(tools);

    if (!list.length) { body.append(empty("No questions match these filters.")); return; }
    const wrap = el("div", "a-list");
    list.slice(0, S.shown).forEach((v) => wrap.append(questionRow(v)));
    body.append(wrap);
    if (list.length > S.shown) {
      const more = el("div", "an-more");
      more.append(btn("Show more", "btn-outline", () => { S.shown += SHOW_STEP; render(); }));
      body.append(more);
    }
  }

  function tiles(ov, questions, perQuestion, flagged, tests) {
    const box = el("div", "an-tiles");
    const add = (k, v) => { const t = el("div", "an-tile"); t.append(el("div", "an-tile-v", v), el("div", "an-tile-k", k)); box.append(t); };
    add("Questions attempted", String(questions));
    add("Attempts", String(ov.attempts));
    add("Correct (auto-marked)", L.fmtPct(ov.pct));
    add("Average time (practice)", L.fmtSecs(ov.avgSecs));
    if (perQuestion) add("Flagged questions", String(flagged || 0));
    if (tests !== null && tests !== undefined) add("Tests taken", String(tests));
    return box;
  }

  function metrics(pairs) {
    const g = el("div", "an-metrics");
    pairs.forEach((p) => {
      const c = el("div", "an-metric");
      c.append(el("div", "an-metric-v", p[1]), el("div", "an-metric-k", p[0]));
      g.append(c);
    });
    return g;
  }

  function wrongText(v) {
    const a = v.a;
    if (a.topWrong) return "Option " + L.optionLabel(a.type, a.topWrong.idx) + " (" + a.topWrong.n + " of " + a.wrongTotal + " wrong)";
    if (a.type === "mcq_multi") return "See details";
    return "—";
  }

  function questionRow(v) {
    const a = v.a, m = v.m;
    const row = el("div", "an-qrow");
    const top = el("div", "q-qtop");
    top.append(el("span", "q-tag q-id", v.name), el("span", "q-tag", typeLabel(a.type)));
    if (v.diff) top.append(el("span", "q-tag", v.diff));
    if (m && m.marks !== undefined) top.append(el("span", "q-tag", m.marks + (m.marks === 1 ? " mark" : " marks")));
    if (m && m.missing) top.append(el("span", "q-tag", "Question removed"));
    if (v.flag) top.append(el("span", "q-tag an-flag", v.flag.short));
    row.append(top);

    const scoredNote = a.scored && a.scored !== a.attempts ? " (" + a.scored + " scored)" : "";
    row.append(metrics([
      ["Attempts", String(a.attempts)],
      ["Correct", a.pct === null ? "Self-assessed" : L.fmtPct(a.pct) + scoredNote],
      ["Avg time", L.fmtSecs(a.avgSecs)],
      ["Most chosen wrong", wrongText(v)]
    ]));

    const detail = el("div", "an-detail");
    detail.hidden = true;
    let opened = false;
    const b = btn("Details", "btn-outline", async () => {
      detail.hidden = !detail.hidden;
      b.textContent = detail.hidden ? "Details" : "Hide details";
      if (!detail.hidden && !opened) { opened = true; await fillDetail(detail, v); }
    });
    const acts = el("div", "q-qacts");
    acts.append(b);
    row.append(acts, detail);
    return row;
  }

  async function fillDetail(box, v) {
    const a = v.a, m = v.m;
    box.textContent = "";
    if (v.flag) box.append(el("p", "an-flagtext", v.flag.text));
    if (m && !m.missing) {
      if (a.type === "assertion_reason") {
        const x = el("div", "pq-ar"); x.append(el("strong", null, "Assertion (A): "), latexBlock("pq-inline", m.assertionLatex));
        const y = el("div", "pq-ar"); y.append(el("strong", null, "Reason (R): "), latexBlock("pq-inline", m.reasonLatex));
        box.append(x, y);
      } else if (m.questionLatex) {
        box.append(latexBlock("pq-stem", m.questionLatex));
      }
    } else {
      box.append(el("p", "field-hint", "This question has been removed, so only its results are shown."));
    }

    if (L.OPTION_TYPES.indexOf(a.type) === -1) {
      box.append(el("p", "field-hint", a.pct === null
        ? "Written answers are self-assessed and not included in % correct."
        : "A breakdown by option is available for choice-based questions only."));
      typeset(box);
      return;
    }

    const texts = a.type === "true_false" ? ["True", "False"] : (m && m.options ? m.options : []);
    const count = Math.max(texts.length, ...Object.keys(a.picks).map((k) => Number(k) + 1), 0);
    let correct = null;
    if (m && !m.missing) {
      try { correct = (await C.loadKey(a.q)).correct; }
      catch (err) { console.error(err); box.append(el("p", "field-hint", "The answer key could not be read, so correct options are not marked. " + api.failText(err))); }
    }

    box.append(el("div", "an-optitle", "How often each option was chosen (" + a.pickN + " answered)"));
    const list = el("div", "an-opts");
    for (let i = 0; i < count; i++) {
      const n = a.picks[i] || 0;
      const pct = a.pickN ? Math.round((1000 * n) / a.pickN) / 10 : 0;
      const isOk = correct && correct.indexOf(i) !== -1;
      const o = el("div", "an-opt" + (isOk ? " is-correct" : ""));
      const lab = el("div", "an-opt-head");
      lab.append(el("strong", null, L.optionLabel(a.type, i) + (a.type === "true_false" ? "" : ".")));
      if (texts[i] && a.type !== "true_false") lab.append(latexBlock("pq-inline", texts[i]));
      if (isOk) lab.append(el("span", "an-opt-ok", "Correct answer"));
      const barWrap = el("div", "an-bar");
      const fill = el("div", "an-bar-fill"); fill.style.width = Math.min(100, pct) + "%";
      barWrap.append(fill);
      o.append(lab, barWrap, el("div", "an-opt-n", n + " (" + pct + "%)"));
      list.append(o);
    }
    box.append(list);

    const tw = a.type === "mcq_multi" && correct ? L.topWrongWithKey(a.picks, correct) : a.topWrong;
    box.append(el("p", "field-hint", tw
      ? "Most chosen wrong option: " + L.optionLabel(a.type, tw.idx) + " (" + tw.n + (a.type === "mcq_multi" ? " selections)." : " wrong answers).")
      : "No wrong option has been chosen yet."));
    typeset(box);
  }

  /* ───────────────────────── CSV ───────────────────────── */
  function exportCsv(headers, rows, slug) {
    const text = L.toCsv(headers, rows);
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "analytics-" + String(slug).toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  start();
  return { render: render };
}
