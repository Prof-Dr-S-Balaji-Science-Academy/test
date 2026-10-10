/* ─────────────────────────────────────────────────────────────────────
 * paper-admin.js  (ES module, ProfAdmin "Papers" section, Phase 7)
 * The paper list and the paper builder: fixed papers (questions picked one
 * by one) and rule-based papers (chapters, types and a difficulty mix; the
 * questions are drawn when a student starts). Everything here is display;
 * the real lock is Firestore Rules v8. All text is inserted with textContent.
 * ───────────────────────────────────────────────────────────────────── */
import * as Q from "./question-core.js";
import * as P from "./paper-core.js";
import * as L from "./paper-logic.js";
import { levelLabel } from "./admin-core.js";

export function initPapers(host, api) {
  const el = api.el;
  const S = { rows: [], loaded: false, busy: false };
  let uid = 0;

  const scopes = [];
  Q.FOLDERS.forEach((f) => f.subjects.forEach((s) => scopes.push({
    key: f.board + "|" + f.cls + "|" + s, board: f.board, cls: f.cls, subject: s, label: f.label + " · " + s
  })));
  const scopeLabel = (p) => { const s = scopes.find((x) => x.board === p.board && x.cls === p.cls && x.subject === p.subject); return s ? s.label : ""; };
  const fmtDate = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

  function field(label, control, hint) {
    const w = el("div", "field");
    const id = "pa" + (++uid);
    const l = el("label", "field-label", label);
    l.htmlFor = id;
    if (control.id === "" || !control.id) control.id = id;
    w.append(l, control);
    if (hint) w.append(el("p", "field-hint", hint));
    return w;
  }
  function pills(legend, items, selected, onChange, hint) {
    const fs = el("fieldset", "field");
    fs.append(el("legend", "field-label", legend));
    const box = el("div", "choices");
    items.forEach((it) => {
      const lab = el("label", "choice");
      const inp = el("input");
      inp.type = "checkbox"; inp.checked = selected.has(it.value);
      inp.addEventListener("change", () => { if (inp.checked) selected.add(it.value); else selected.delete(it.value); if (onChange) onChange(); });
      lab.append(inp, el("span", null, it.label));
      box.append(lab);
    });
    fs.append(box);
    if (hint) fs.append(el("p", "field-hint", hint));
    return fs;
  }
  const badge = (t) => el("span", "q-tag", t);

  /* ───────────────────────── List ───────────────────────── */
  async function load() {
    S.busy = true; renderList();
    try { S.rows = await P.listPapers(); S.loaded = true; }
    catch (err) { console.error(err); api.notice("Papers could not be loaded. " + api.failText(err), true); }
    S.busy = false; renderList();
  }

  function renderList() {
    host.textContent = "";
    const head = el("div", "admin-head");
    const t = el("div"); t.append(el("h2", null, "Papers"), el("p", null, "Fixed papers and auto-generated (rule-based) papers for mock tests."));
    const btns = el("div", "q-headbtns");
    const nw = el("button", "btn btn-primary btn-sm", "New paper"); nw.type = "button";
    nw.addEventListener("click", () => { api.notice(""); renderEditor(null); });
    const rf = el("button", "btn btn-outline btn-sm", "Refresh"); rf.type = "button";
    rf.addEventListener("click", () => { api.notice(""); load(); });
    btns.append(nw, rf);
    head.append(t, btns);
    host.append(head);

    if (S.busy && !S.loaded) { host.append(el("div", "portal-loading", "Loading…")); return; }
    if (!S.rows.length) { host.append(el("div", "message-box", "No papers yet. Choose New paper to make the first one.")); return; }

    const list = el("div", "a-list");
    S.rows.forEach((p) => {
      const row = el("div", "pa-row");
      const main = el("div", "pa-main");
      main.append(el("div", "a-name", p.title));
      main.append(el("div", "a-sub", scopeLabel(p) + " · " + (p.mode === "rule" ? "Auto-generated" : "Fixed") + " · " + p.count + (p.count === 1 ? " question" : " questions") + " · " + p.durationMin + " min"));
      main.append(el("div", "a-sub", "For " + (p.levels || []).map(levelLabel).join(", ") + (fmtDate(p.createdAt) ? " · created " + fmtDate(p.createdAt) : "")));
      const tags = el("div", "q-qtop");
      tags.append(badge(p.status === "published" ? "Published" : "Draft"), badge(p.access === "public" ? "Public" : "Locked"));
      if (p.negativeMarking > 0) tags.append(badge("Negative marking"));
      main.append(tags);
      const acts = el("div", "q-qacts");
      const mk = (label, cls, fn) => { const b = el("button", "btn " + cls + " btn-sm", label); b.type = "button"; b.addEventListener("click", fn); acts.append(b); };
      mk("Edit", "btn-outline", () => { api.notice(""); renderEditor(p); });
      mk(p.status === "published" ? "Unpublish" : "Publish", "btn-outline", () => quick(p, () => P.setPaperStatus(p.id, p.status === "published" ? "draft" : "published"),
        { status: p.status === "published" ? "draft" : "published" }));
      mk(p.access === "public" ? "Lock" : "Make public", "btn-outline", () => quick(p, () => P.setPaperAccess(p.id, p.access === "public" ? "locked" : "public"),
        { access: p.access === "public" ? "locked" : "public" }));
      mk("Delete", "btn-outline", async () => {
        const ok = await api.confirmDialog({ title: "Delete this paper?", text: "\"" + p.title + "\" will be deleted. Test results students already have are not affected.", ok: "Delete paper", danger: true });
        if (!ok) return;
        try { await P.deletePaper(p.id); S.rows = S.rows.filter((x) => x.id !== p.id); renderList(); api.notice("Paper deleted."); }
        catch (err) { console.error(err); api.notice("Delete failed. " + api.failText(err), true); }
      });
      row.append(main, acts);
      list.append(row);
    });
    host.append(list);
  }

  async function quick(p, fn, patch) {
    try { await fn(); Object.assign(p, patch); renderList(); api.notice("Saved."); }
    catch (err) { console.error(err); api.notice("Could not save. " + api.failText(err), true); }
  }

  /* ───────────────────────── Builder ───────────────────────── */
  async function renderEditor(existing) {
    host.textContent = "";
    const isNew = !existing;
    const E = {
      scope: existing ? scopes.find((x) => x.board === existing.board && x.cls === existing.cls && x.subject === existing.subject) : scopes[0],
      mode: existing ? existing.mode : "fixed",
      levels: new Set(existing ? existing.levels : []),
      chapters: [], chapterIds: new Set(existing && existing.rules ? existing.rules.chapterIds : []),
      types: new Set(existing && existing.rules ? existing.rules.types : Q.TYPES.map((t) => t.id)),
      mix: existing && existing.rules ? { ...existing.rules.mix } : { Easy: 0, Medium: 0, Hard: 0 },
      selected: [], pickChapter: "", pick: { rows: [], cursor: null, done: true }
    };
    if (isNew) Q.levelsFor(E.scope.board, E.scope.cls, E.scope.subject).forEach((l) => E.levels.add(l));

    const wrap = el("div", "q-form pa-form");
    host.append(wrap);
    wrap.append(el("h2", "pq-h2", isNew ? "New paper" : "Edit paper"));
    const msg = el("div", "portal-error"); msg.hidden = true;

    /* basics */
    const title = el("input", "input"); title.type = "text"; title.maxLength = 120; title.value = existing ? existing.title : "";
    const desc = el("textarea", "input q-ta"); desc.maxLength = 500; desc.value = existing ? existing.description : "";
    desc.style.fontFamily = "inherit";
    wrap.append(field("Title", title), field("Description (optional)", desc, "Shown to students above the Start button."));

    /* scope and levels (scope is fixed once the paper exists) */
    const scopeSel = el("select", "input");
    scopes.forEach((s) => { const o = el("option", null, s.label); o.value = s.key; scopeSel.append(o); });
    scopeSel.value = E.scope.key; scopeSel.disabled = !isNew;
    const scopeBox = el("div"); wrap.append(scopeBox);
    scopeBox.append(field("Board, class and subject", scopeSel, isNew ? "All questions of the paper come from this subject." : "Cannot be changed after the paper is created."));
    const levelBox = el("div"); wrap.append(levelBox);
    function drawLevels() {
      levelBox.textContent = "";
      const items = Q.levelsFor(E.scope.board, E.scope.cls, E.scope.subject).map((l) => ({ value: l, label: levelLabel(l) }));
      levelBox.append(pills("Student levels that can see this paper", items, E.levels, null));
    }
    drawLevels();

    /* mode */
    const modeBox = el("fieldset", "field");
    modeBox.append(el("legend", "field-label", "How the paper is made"));
    const mc = el("div", "choices");
    [["fixed", "Fixed question list"], ["rule", "Auto-generated from rules"]].forEach((m) => {
      const lab = el("label", "choice"); const inp = el("input");
      inp.type = "radio"; inp.name = "pa-mode"; inp.value = m[0]; inp.checked = E.mode === m[0]; inp.disabled = !isNew;
      inp.addEventListener("change", () => { E.mode = m[0]; drawMode(); });
      lab.append(inp, el("span", null, m[1])); mc.append(lab);
    });
    modeBox.append(mc);
    if (!isNew) modeBox.append(el("p", "field-hint", "Cannot be changed after the paper is created."));
    wrap.append(modeBox);

    const modeArea = el("div"); wrap.append(modeArea);

    /* settings */
    const dur = el("input", "input q-marks-input"); dur.type = "number"; dur.min = "1"; dur.max = "300"; dur.step = "1"; dur.inputMode = "numeric";
    dur.value = existing ? existing.durationMin : 60;
    const neg = el("select", "input");
    L.NEGATIVE_CHOICES.forEach((c) => { const o = el("option", null, c.label); o.value = String(c.value); neg.append(o); });
    const curNeg = existing ? existing.negativeMarking : 0;
    const near = L.NEGATIVE_CHOICES.find((c) => Math.abs(c.value - curNeg) < 1e-6);
    neg.value = String(near ? near.value : 0);
    const shuffle = el("input", "check"); shuffle.type = "checkbox"; shuffle.checked = existing ? !!existing.shuffle : true;
    const showKeys = el("input", "check"); showKeys.type = "checkbox"; showKeys.checked = existing ? !!existing.showKeys : true;
    const access = el("select", "input");
    [["public", "Public (students can start it)"], ["locked", "Locked (students see it but cannot start it)"]].forEach((a) => { const o = el("option", null, a[1]); o.value = a[0]; access.append(o); });
    access.value = existing ? existing.access : "locked";
    const status = el("select", "input");
    [["draft", "Draft (students cannot see it)"], ["published", "Published (listed for the chosen levels)"]].forEach((a) => { const o = el("option", null, a[1]); o.value = a[0]; status.append(o); });
    status.value = existing ? existing.status : "draft";

    wrap.append(field("Duration (minutes)", dur, "One timer for the whole paper. If a student closes the page, the clock keeps running and they can resume until it runs out."));
    wrap.append(field("Negative marking", neg, "Taken off for a wrong auto-marked answer. Unanswered questions never lose marks."));

    const shuffleRow = el("label", "pa-check"); shuffleRow.append(shuffle, el("span", null, "Shuffle the order of questions and options"));
    const shuffleHint = el("p", "field-hint");
    const shuffleField = el("div", "field"); shuffleField.append(shuffleRow, shuffleHint);
    const keysRow = el("label", "pa-check"); keysRow.append(showKeys, el("span", null, "Show answer key and explanations after submission"));
    const keysField = el("div", "field"); keysField.append(keysRow, el("p", "field-hint", "When off, students see their score and which answers were right or wrong, but not the correct answers or explanations. The same questions are still open in practice mode."));
    wrap.append(shuffleField, keysField, field("Access", access), field("Status", status));

    /* mode area */
    function drawMode() {
      modeArea.textContent = "";
      const isRule = E.mode === "rule";
      shuffle.disabled = isRule;
      if (isRule) shuffle.checked = true;
      shuffleHint.textContent = isRule ? "Always on for auto-generated papers." : "Off keeps the question and option order exactly as in the paper.";
      if (isRule) drawRule(); else drawFixed();
    }

    async function ensureChapters() {
      if (E.chaptersFor === E.scope.key) return;
      E.chapters = await Q.fetchChapters(E.scope.board, E.scope.cls, E.scope.subject);
      E.chaptersFor = E.scope.key;
    }

    /* — rule mode — */
    async function drawRule() {
      const card = el("section", "portal-card pa-card");
      card.append(el("h3", "pa-h3", "Rules"));
      modeArea.append(card);
      const loading = el("div", "portal-loading", "Loading chapters…"); card.append(loading);
      try { await ensureChapters(); } catch (err) { console.error(err); loading.textContent = "Chapters could not be loaded. " + api.failText(err); return; }
      if (E.mode !== "rule") return;
      loading.remove();
      if (!E.chapters.length) { card.append(el("p", "field-hint", "This subject has no chapters yet. Add chapters and questions in the Questions section first.")); return; }
      card.append(pills("Chapters to draw from", E.chapters.map((c) => ({ value: c.id, label: "Ch " + c.chapterNumber + ": " + c.chapterName })), E.chapterIds, clearPool));
      card.append(pills("Question types allowed", Q.TYPES.map((t) => ({ value: t.id, label: t.label })), E.types, clearPool,
        "Only multiple-choice and Assertion and Reason questions are marked on screen; other types are written on paper."));
      const mixBox = el("div", "q-numrow");
      const inputs = {};
      ["Easy", "Medium", "Hard"].forEach((d) => {
        const i = el("input", "input q-marks-input"); i.type = "number"; i.min = "0"; i.max = "100"; i.step = "1"; i.inputMode = "numeric";
        i.value = E.mix[d] || 0;
        i.addEventListener("input", () => { E.mix[d] = parseInt(i.value, 10) || 0; total.textContent = "Total questions: " + (E.mix.Easy + E.mix.Medium + E.mix.Hard); clearPool(); });
        inputs[d] = i;
        mixBox.append(field(d + " questions", i));
      });
      card.append(mixBox);
      const total = el("div", "q-total", "Total questions: " + ((E.mix.Easy || 0) + (E.mix.Medium || 0) + (E.mix.Hard || 0)));
      card.append(total);
      card.append(el("p", "field-hint", "Each student gets a different set. A paper takes at most one question from each Grouping label of a chapter. Each question carries its own marks, so the paper's total marks depend on the draw."));
      const poolBtn = el("button", "btn btn-outline btn-sm", "Check available questions"); poolBtn.type = "button";
      const poolOut = el("div", "q-note"); poolOut.hidden = true;
      function clearPool() { poolOut.hidden = true; }
      poolBtn.addEventListener("click", async () => {
        poolOut.hidden = false; poolOut.textContent = "Counting…";
        try {
          const counts = await P.poolCounts(Array.from(E.chapterIds), Array.from(E.types));
          poolOut.textContent = "";
          ["Easy", "Medium", "Hard"].forEach((d) => {
            const need = E.mix[d] || 0;
            const line = el("div", need > counts[d] ? "is-warn" : null, d + ": " + counts[d] + " published, " + need + " wanted" + (need > counts[d] ? " (not enough)" : ""));
            poolOut.append(line);
          });
          poolOut.append(el("div", "is-warn", "Grouping can lower these numbers."));
        } catch (err) {
          console.error(err);
          poolOut.textContent = err && err.message === "TOO_MANY" ? "Too many chapter and type choices to count at once. Choose fewer chapters or types." : "Could not count. " + api.failText(err);
        }
      });
      card.append(poolBtn, poolOut);
    }

    /* — fixed mode — */
    async function drawFixed() {
      const card = el("section", "portal-card pa-card");
      card.append(el("h3", "pa-h3", "Questions"));
      modeArea.append(card);
      const selBox = el("div"); const pickBox = el("div");
      card.append(selBox, pickBox);

      function drawSelected() {
        selBox.textContent = "";
        const marks = E.selected.reduce((a, s) => a + (Number(s.marks) || 0), 0);
        selBox.append(el("div", "q-total", E.selected.length + (E.selected.length === 1 ? " question" : " questions") + " · " + L.round2(marks) + " marks in total"));
        if (!E.selected.length) { selBox.append(el("p", "field-hint", "No questions yet. Pick them below.")); return; }
        const list = el("div", "pa-sel");
        E.selected.forEach((s, i) => {
          const r = el("div", "pa-selrow");
          const info = el("div", "pa-selinfo");
          info.append(el("strong", null, (i + 1) + ". " + (s.displayId || s.id)));
          info.append(el("span", "a-sub", s.missing ? "Question not found" : (Q.typeLabel(s.type) + " · " + s.difficulty + " · " + s.marks + " marks" + (s.status !== "published" ? " · Draft" : ""))));
          if (s.missing || s.status !== "published") info.lastChild.classList.add("is-warn-text");
          const acts = el("div", "q-qacts");
          const mk = (label, fn, dis) => { const b = el("button", "btn btn-outline btn-sm", label); b.type = "button"; b.disabled = !!dis; b.addEventListener("click", fn); acts.append(b); };
          mk("Up", () => { E.selected.splice(i - 1, 0, E.selected.splice(i, 1)[0]); drawSelected(); drawPick(); }, i === 0);
          mk("Down", () => { E.selected.splice(i + 1, 0, E.selected.splice(i, 1)[0]); drawSelected(); drawPick(); }, i === E.selected.length - 1);
          mk("Remove", () => { E.selected.splice(i, 1); drawSelected(); drawPick(); });
          r.append(info, acts); list.append(r);
        });
        selBox.append(list);
      }

      async function drawPick() {
        pickBox.textContent = "";
        pickBox.append(el("h3", "pa-h3 pq-gap", "Add questions"));
        const loading = el("div", "portal-loading", "Loading chapters…"); pickBox.append(loading);
        try { await ensureChapters(); } catch (err) { console.error(err); loading.textContent = "Chapters could not be loaded. " + api.failText(err); return; }
        if (E.mode !== "fixed") return;
        loading.remove();
        if (!E.chapters.length) { pickBox.append(el("p", "field-hint", "This subject has no chapters yet.")); return; }
        const sel = el("select", "input");
        const o0 = el("option", null, "Choose a chapter"); o0.value = ""; sel.append(o0);
        E.chapters.forEach((c) => { const o = el("option", null, "Ch " + c.chapterNumber + ": " + c.chapterName); o.value = c.id; sel.append(o); });
        sel.value = E.pickChapter;
        sel.addEventListener("change", async () => {
          E.pickChapter = sel.value; E.pick = { rows: [], cursor: null, done: true };
          if (sel.value) await loadMore(true); else drawPick();
        });
        pickBox.append(field("Chapter", sel));
        if (!E.pickChapter) return;
        const chosen = new Set(E.selected.map((s) => s.id));
        const list = el("div", "a-list");
        E.pick.rows.forEach((q) => {
          const r = el("div", "q-qrow");
          const top = el("div", "q-qtop");
          top.append(badge(q.displayId), badge(Q.typeLabel(q.type)), badge(q.difficulty), badge(q.marks + " marks"));
          if (q.status !== "published") top.append(badge("Draft"));
          const stem = el("div", "q-stem", q.type === "assertion_reason" ? (q.assertionLatex || "") : (q.questionLatex || ""));
          const acts = el("div", "q-qacts");
          const add = el("button", "btn btn-outline btn-sm", chosen.has(q.id) ? "Added" : "Add"); add.type = "button";
          add.disabled = chosen.has(q.id) || q.status !== "published" || E.selected.length >= L.MAX_QUESTIONS;
          add.addEventListener("click", () => {
            E.selected.push({ id: q.id, displayId: q.displayId, type: q.type, difficulty: q.difficulty, marks: q.marks, status: q.status });
            drawSelected(); drawPick();
          });
          acts.append(add);
          r.append(top, stem, acts); list.append(r);
        });
        pickBox.append(list);
        if (!E.pick.rows.length) pickBox.append(el("p", "field-hint", "This chapter has no questions yet."));
        if (!E.pick.done) {
          const more = el("button", "btn btn-outline btn-sm", "Load more"); more.type = "button";
          more.addEventListener("click", () => loadMore(false));
          pickBox.append(more);
        }
      }
      async function loadMore(first) {
        try {
          const res = await Q.fetchQuestions(E.pickChapter, first ? null : E.pick.cursor);
          E.pick = { rows: first ? res.rows : E.pick.rows.concat(res.rows), cursor: res.cursor || E.pick.cursor, done: res.done };
        } catch (err) { console.error(err); api.notice("Questions could not be loaded. " + api.failText(err), true); }
        drawPick();
      }

      drawSelected(); drawPick();
    }

    scopeSel.addEventListener("change", () => {
      E.scope = scopes.find((x) => x.key === scopeSel.value);
      E.levels.clear(); Q.levelsFor(E.scope.board, E.scope.cls, E.scope.subject).forEach((l) => E.levels.add(l));
      E.chapterIds.clear(); E.selected = []; E.pickChapter = ""; E.pick = { rows: [], cursor: null, done: true }; E.chaptersFor = null;
      drawLevels(); drawMode();
    });

    /* existing fixed paper: look up its questions */
    if (existing && existing.mode === "fixed") {
      const metas = await P.fetchQuestionMeta(existing.questionIds || []);
      E.selected = (existing.questionIds || []).map((id, i) => {
        const m = metas[i];
        return m ? { id: id, displayId: m.displayId, type: m.type, difficulty: m.difficulty, marks: m.marks, status: m.status } : { id: id, missing: true };
      });
    }
    drawMode();

    /* save */
    const acts = el("div", "q-saveacts pq-actions");
    const save = el("button", "btn btn-primary", isNew ? "Create paper" : "Save changes"); save.type = "button";
    const cancel = el("button", "btn btn-outline", "Cancel"); cancel.type = "button";
    cancel.addEventListener("click", () => { api.notice(""); renderList(); });
    acts.append(save, cancel);
    wrap.append(msg, acts);

    save.addEventListener("click", async () => {
      msg.hidden = true;
      const levelsInOrder = Q.levelsFor(E.scope.board, E.scope.cls, E.scope.subject).filter((l) => E.levels.has(l));
      const form = {
        title: title.value, description: desc.value, levels: levelsInOrder, mode: E.mode,
        durationMin: Number(dur.value), negativeMarking: parseFloat(neg.value),
        questionIds: E.selected.map((s) => s.id),
        chapterIds: Array.from(E.chapterIds), types: Array.from(E.types), mix: E.mix
      };
      let err = L.checkPaperForm(form);
      if (!err && E.mode === "fixed" && status.value === "published" && E.selected.some((s) => s.missing || s.status !== "published")) {
        err = "A published paper can only contain published questions. Remove the draft or missing questions, or save the paper as a draft.";
      }
      if (err) { msg.textContent = err; msg.hidden = false; msg.scrollIntoView({ block: "center" }); return; }

      const fields = {
        title: form.title.trim(), description: form.description.trim(), levels: levelsInOrder,
        durationMin: form.durationMin, negativeMarking: form.negativeMarking,
        showKeys: showKeys.checked, shuffle: E.mode === "rule" ? true : shuffle.checked,
        access: access.value, status: status.value
      };
      if (E.mode === "fixed") { fields.questionIds = form.questionIds; fields.count = form.questionIds.length; }
      else {
        const order = (arr, all) => all.filter((x) => arr.indexOf(x) !== -1);
        fields.rules = {
          chapterIds: order(form.chapterIds, E.chapters.map((c) => c.id)),
          types: order(form.types, Q.TYPES.map((t) => t.id)),
          mix: { Easy: E.mix.Easy || 0, Medium: E.mix.Medium || 0, Hard: E.mix.Hard || 0 }
        };
        fields.count = fields.rules.mix.Easy + fields.rules.mix.Medium + fields.rules.mix.Hard;
      }
      save.disabled = true;
      try {
        if (isNew) {
          await P.createPaper(api.adminEmail(), { ...fields, board: E.scope.board, cls: E.scope.cls, subject: E.scope.subject, mode: E.mode });
        } else {
          await P.updatePaper(existing.id, fields);
        }
        api.notice(isNew ? "Paper created." : "Paper saved.");
        await load();
      } catch (e) {
        console.error(e);
        msg.textContent = "Could not save the paper. " + api.failText(e); msg.hidden = false; save.disabled = false;
      }
    });
  }

  load();
  return { reload: load };
}
