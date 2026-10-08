/* ─────────────────────────────────────────────────────────────────────
 * question-manager.js  (ES module, ProfAdmin "Questions" section)
 * Folder-style browsing (Board → Class → Subject → Chapter), chapter
 * management, the question list, and the LaTeX-aware question editor.
 * Everything here is cosmetic; the real lock is Firestore Rules v4.
 * ───────────────────────────────────────────────────────────────────── */
import * as Q from "./question-core.js";
import * as IU from "./image-upload.js";
import { cleanPasted, validateLatex, insertSnippet, SYMBOL_GROUPS } from "./latex-tools.js";

export function initQuestions(host, api) {
  const el = api.el;
  let uid = 0;
  let activeTA = null;

  /* ── State ── */
  const S = {
    board: null, cls: null, subject: null, chapter: null,
    chapters: [], chaptersLoaded: false,
    q: { rows: [], cursor: null, done: false, loaded: false, search: "", status: "all", diff: "all", type: "all" },
    edit: null
  };

  /* ── MathJax (loaded by the page; typesetting is queued one at a time) ── */
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
  function typeset(node) {
    chain = chain.then(waitMathJax).then(() => window.MathJax.typesetPromise([node])).catch((e) => console.error(e));
  }
  function clearMath(node) {
    if (window.MathJax && window.MathJax.typesetClear) { try { window.MathJax.typesetClear([node]); } catch (e) { /* ignore */ } }
  }
  function setPreview(box, text) {
    clearMath(box);
    box.textContent = text;
    box.hidden = !text.trim();
    if (text.trim()) typeset(box);
  }

  /* ── Small helpers ── */
  const letter = (i) => String.fromCharCode(65 + i);
  const FOLDER_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const tag = (text, cls) => el("span", "q-tag" + (cls ? " " + cls : ""), text);
  const marksText = (m) => m + (m === 1 ? " mark" : " marks");
  function parseMarks(v) {
    const n = parseFloat(v);
    if (!isFinite(n) || n <= 0 || n > 100 || (n * 2) % 1 !== 0) return NaN;
    return n;
  }
  /* Short version of a LaTeX string for lists; never cuts inside a math pair. */
  function excerpt(t) {
    t = String(t || "").replace(/\s+/g, " ").trim();
    if (t.length <= 360) return t;
    let c = t.slice(0, 360);
    const o1 = c.lastIndexOf("\\("), c1 = c.lastIndexOf("\\)");
    if (o1 > c1) c = c.slice(0, o1);
    const o2 = c.lastIndexOf("\\["), c2 = c.lastIndexOf("\\]");
    if (o2 > c2) c = c.slice(0, o2);
    return c.trim() + " \u2026";
  }
  function stemText(q) {
    if (q.type === "assertion_reason") return "Assertion (A): " + (q.assertionLatex || "") + "  Reason (R): " + (q.reasonLatex || "");
    return q.questionLatex || "";
  }
  function showIssues(box, issues) {
    box.textContent = "";
    issues.forEach((i) => box.append(el("div", i.level === "error" ? "is-error" : "is-warn", i.message)));
    box.hidden = !issues.length;
  }

  /* ───────────────────────── Navigation ───────────────────────── */
  function crumbs() {
    const nav = el("nav", "q-crumbs");
    nav.setAttribute("aria-label", "Question folders");
    const add = (label, go) => {
      if (nav.childNodes.length) nav.append(el("span", "q-crumb-sep", "/"));
      if (go) {
        const b = el("button", "q-crumb", label);
        b.type = "button";
        b.addEventListener("click", go);
        nav.append(b);
      } else nav.append(el("span", "q-crumb is-current", label));
    };
    const deep = !!(S.board);
    add("Questions", deep ? () => goTo(0) : null);
    if (S.board) add(S.board, S.cls ? () => goTo(1) : null);
    if (S.cls) add("Class " + S.cls, S.subject ? () => goTo(2) : null);
    if (S.subject) add(S.subject, S.chapter ? () => goTo(3) : null);
    if (S.chapter) add("Chapter " + S.chapter.chapterNumber, S.edit ? () => closeEditor() : null);
    if (S.edit) add(S.edit.existing ? "Edit question" : "New question", null);
    return nav;
  }

  /* level: 0 root, 1 board, 2 class, 3 subject (chapter list) */
  function goTo(level) {
    api.notice("");
    S.edit = null;
    S.chapter = null;
    if (level <= 2) { S.subject = null; S.chapters = []; S.chaptersLoaded = false; }
    if (level <= 1) S.cls = null;
    if (level <= 0) S.board = null;
    render();
    if (level === 3 && !S.chaptersLoaded) loadChapters();
  }

  function render() {
    clearMath(host);
    host.textContent = "";
    host.append(crumbs());
    if (S.edit) return renderEditor();
    if (S.chapter) return renderQuestionList();
    if (S.subject) return renderChapters();
    if (S.cls) return renderSubjects();
    if (S.board) return renderClasses();
    return renderBoards();
  }

  function head(title, sub) {
    const h = el("div", "admin-head");
    const d = el("div");
    d.append(el("h2", null, title));
    if (sub) d.append(el("p", null, sub));
    h.append(d);
    return h;
  }

  function folderGrid(items) {
    const g = el("div", "q-folders");
    items.forEach((it) => {
      const b = el("button", "q-folder");
      b.type = "button";
      const ico = el("span", "q-folder-ico");
      ico.innerHTML = FOLDER_SVG;
      const t = el("span", "q-folder-text");
      t.append(el("span", "q-folder-title", it.title), el("span", "q-folder-sub", it.sub));
      b.append(ico, t);
      b.addEventListener("click", it.go);
      g.append(b);
    });
    return g;
  }

  function renderBoards() {
    host.append(head("Question bank", "Choose a board to open its folders."));
    const boards = [];
    Q.FOLDERS.forEach((f) => { if (boards.indexOf(f.board) === -1) boards.push(f.board); });
    host.append(folderGrid(boards.map((b) => ({
      title: b,
      sub: Q.FOLDERS.filter((f) => f.board === b).map((f) => "Class " + f.cls).join(", "),
      go: () => { S.board = b; render(); }
    }))));
  }
  function renderClasses() {
    host.append(head(S.board, "Choose a class."));
    host.append(folderGrid(Q.FOLDERS.filter((f) => f.board === S.board).map((f) => ({
      title: "Class " + f.cls, sub: f.subjects.join(", "),
      go: () => { S.cls = f.cls; render(); }
    }))));
  }
  function renderSubjects() {
    const f = Q.FOLDERS.find((x) => x.board === S.board && x.cls === S.cls);
    host.append(head(S.board + " \u00b7 Class " + S.cls, "Choose a subject."));
    host.append(folderGrid(f.subjects.map((s) => ({
      title: s, sub: "Chapters and questions",
      go: () => { S.subject = s; S.chapters = []; S.chaptersLoaded = false; render(); loadChapters(); }
    }))));
  }

  /* ───────────────────────── Chapters ───────────────────────── */
  async function loadChapters() {
    S.chaptersLoaded = false;
    render();
    try {
      const rows = await Q.fetchChapters(S.board, S.cls, S.subject);
      const counts = await Promise.all(rows.map((r) => Q.countQuestions(r.id).catch(() => null)));
      rows.forEach((r, i) => { r.count = counts[i]; });
      S.chapters = rows;
    } catch (err) {
      console.error(err);
      S.chapters = [];
      api.notice("Could not load chapters. " + api.failText(err), true);
    }
    S.chaptersLoaded = true;
    render();
  }

  function renderChapters() {
    const h = head(S.subject, S.board + " \u00b7 Class " + S.cls);
    const add = el("button", "btn btn-primary btn-sm", "Add chapter");
    add.type = "button";
    add.addEventListener("click", () => openChapterDialog(null));
    h.append(add);
    host.append(h);

    const box = el("div", "a-list");
    if (!S.chaptersLoaded) box.append(el("div", "a-empty", "Loading\u2026"));
    else if (!S.chapters.length) box.append(el("div", "a-empty", "No chapters yet. Use Add chapter to create the first one."));
    else {
      S.chapters.forEach((c) => {
        const row = el("div", "q-ch");
        const num = el("div", "q-ch-num", "Ch " + c.chapterNumber);
        const nm = el("div");
        nm.append(el("div", "a-name", c.chapterName));
        const sub = [];
        if (c.edition) sub.push(c.edition);
        sub.push(c.count == null ? "Count unavailable" : c.count + (c.count === 1 ? " question" : " questions"));
        nm.append(el("div", "a-sub", sub.join(" \u00b7 ")));
        const acts = el("div", "q-ch-acts");
        const open = el("button", "btn btn-primary btn-sm", "Open");
        open.type = "button";
        open.addEventListener("click", () => openChapter(c));
        const edit = el("button", "btn btn-outline btn-sm", "Edit");
        edit.type = "button";
        edit.addEventListener("click", () => openChapterDialog(c));
        const del = el("button", "btn btn-danger btn-sm", "Delete");
        del.type = "button";
        del.addEventListener("click", () => deleteChapterFlow(c));
        acts.append(open, edit, del);
        row.append(num, nm, acts);
        box.append(row);
      });
    }
    host.append(box);
  }

  /* Chapter dialog (add / edit) */
  const dlgCh = el("dialog", "a-dialog");
  dlgCh.setAttribute("aria-labelledby", "qch-title");
  dlgCh.innerHTML =
    '<h3 id="qch-title">Chapter</h3>' +
    '<div class="field"><label class="field-label" for="qch-num">Chapter number</label><input class="input" id="qch-num" type="number" min="1" max="99" step="1" inputmode="numeric" /></div>' +
    '<div class="field"><label class="field-label" for="qch-name">Chapter name</label><input class="input" id="qch-name" type="text" maxlength="120" autocomplete="off" /></div>' +
    '<div class="field"><label class="field-label" for="qch-ed">Edition label (optional)</label><input class="input" id="qch-ed" type="text" maxlength="40" autocomplete="off" placeholder="For example 2026-27 edition" /></div>' +
    '<div class="portal-error" id="qch-err" role="alert" hidden></div>' +
    '<div class="a-actions"><button class="btn btn-outline" id="qch-cancel" type="button">Cancel</button><span class="spacer"></span><button class="btn btn-primary" id="qch-save" type="button">Save chapter</button></div>';
  host.parentNode ? host.parentNode.append(dlgCh) : document.body.append(dlgCh);
  const $c = (id) => dlgCh.querySelector("#" + id);

  function openChapterDialog(ch) {
    $c("qch-title").textContent = ch ? "Edit chapter" : "Add chapter";
    $c("qch-num").value = ch ? ch.chapterNumber : "";
    $c("qch-name").value = ch ? ch.chapterName : "";
    $c("qch-ed").value = ch ? (ch.edition || "") : "";
    $c("qch-err").hidden = true;
    $c("qch-cancel").onclick = () => dlgCh.close();
    $c("qch-save").onclick = async () => {
      const num = parseInt($c("qch-num").value, 10);
      const name = $c("qch-name").value.trim();
      const edition = $c("qch-ed").value.trim();
      const err = $c("qch-err");
      if (!(num >= 1 && num <= 99)) { err.textContent = "Enter a chapter number from 1 to 99."; err.hidden = false; return; }
      if (!name) { err.textContent = "Enter the chapter name."; err.hidden = false; return; }
      const clash = S.chapters.some((c) => c.chapterNumber === num && (!ch || c.id !== ch.id));
      $c("qch-save").disabled = true;
      try {
        if (ch) await Q.updateChapter(ch.id, { number: num, name: name, edition: edition });
        else await Q.createChapter({ board: S.board, cls: S.cls, subject: S.subject }, { number: num, name: name, edition: edition });
        dlgCh.close();
        await loadChapters();
        api.notice((ch ? "Chapter updated." : "Chapter added.") + (clash ? " Note: another chapter in this subject also uses number " + num + "." : ""));
      } catch (e) {
        console.error(e);
        err.textContent = "Could not save. " + api.failText(e);
        err.hidden = false;
      }
      $c("qch-save").disabled = false;
    };
    dlgCh.showModal();
  }

  async function deleteChapterFlow(c) {
    let n;
    try { n = await Q.countQuestions(c.id); } catch (e) { console.error(e); api.notice("Could not check the chapter. " + api.failText(e), true); return; }
    if (n > 0) {
      api.notice("This chapter still has " + n + " question" + (n === 1 ? "" : "s") + ". Delete or empty them first; a chapter with questions cannot be deleted.", true);
      return;
    }
    const ok = await api.confirmDialog({
      title: "Delete this chapter?",
      text: "Chapter " + c.chapterNumber + ": " + c.chapterName + ". This cannot be undone.",
      ok: "Delete permanently", danger: true
    });
    if (!ok) return;
    try {
      const r = await Q.deleteChapter(c.id);
      if (!r.ok) { api.notice("Questions were added to this chapter in the meantime, so it was not deleted.", true); return; }
      await loadChapters();
      api.notice("Chapter deleted.");
    } catch (e) {
      console.error(e);
      api.notice("Delete failed. " + api.failText(e), true);
    }
  }

  /* ───────────────────────── Question list ───────────────────────── */
  function openChapter(c) {
    api.notice("");
    S.chapter = c;
    S.q = { rows: [], cursor: null, done: false, loaded: false, search: "", status: "all", diff: "all", type: "all" };
    render();
    loadQuestions(true);
  }

  async function loadQuestions(reset) {
    const q = S.q;
    if (reset) { q.rows = []; q.cursor = null; q.done = false; q.loaded = false; }
    const chapterId = S.chapter && S.chapter.id;
    try {
      const r = await Q.fetchQuestions(chapterId, q.cursor);
      if (!S.chapter || S.chapter.id !== chapterId) return;
      r.rows.forEach((x) => { if (!q.rows.some((y) => y.id === x.id)) q.rows.push(x); });
      q.cursor = r.cursor || q.cursor;
      q.done = r.done;
      q.loaded = true;
    } catch (err) {
      console.error(err);
      q.loaded = true;
      api.notice("Could not load questions. " + api.failText(err), true);
    }
    if (!S.edit && S.chapter) { render(); }
  }

  const visibleQuestions = () => {
    const q = S.q, s = q.search.trim().toLowerCase();
    return q.rows.filter((r) => {
      if (q.status !== "all" && r.status !== q.status) return false;
      if (q.diff !== "all" && r.difficulty !== q.diff) return false;
      if (q.type !== "all" && r.type !== q.type) return false;
      if (s && !((r.displayId || "").toLowerCase().includes(s) || stemText(r).toLowerCase().includes(s))) return false;
      return true;
    }).sort((a, b) => a.serial - b.serial);
  };

  function renderQuestionList() {
    const c = S.chapter;
    const shown = visibleQuestions();
    const h = head("Chapter " + c.chapterNumber + ": " + c.chapterName,
      S.board + " \u00b7 Class " + S.cls + " \u00b7 " + S.subject + (c.edition ? " \u00b7 " + c.edition : ""));
    const addBtn = el("button", "btn btn-primary btn-sm", "Add question");
    addBtn.type = "button";
    addBtn.addEventListener("click", () => { S.edit = { existing: null, key: {} }; render(); window.scrollTo(0, 0); });
    const ref = el("button", "btn btn-outline btn-sm", "Refresh");
    ref.type = "button";
    ref.addEventListener("click", () => { api.notice(""); loadQuestions(true); render(); });
    const hb = el("div", "q-headbtns");
    hb.append(ref, addBtn);
    h.append(hb);
    host.append(h);

    const tb = el("div", "toolbar");
    const search = el("input", "input");
    search.type = "search"; search.placeholder = "Search ID or question text"; search.value = S.q.search;
    search.setAttribute("aria-label", "Search questions");
    const sel = (label, key, opts) => {
      const s = el("select", "input");
      s.setAttribute("aria-label", label);
      opts.forEach((o) => { const op = el("option", null, o[1]); op.value = o[0]; s.append(op); });
      s.value = S.q[key];
      s.addEventListener("change", () => { S.q[key] = s.value; rerenderList(); });
      return s;
    };
    search.addEventListener("input", () => { S.q.search = search.value; rerenderList(); });
    tb.append(search,
      sel("Filter by status", "status", [["all", "All statuses"], ["draft", "Draft"], ["published", "Published"]]),
      sel("Filter by difficulty", "diff", [["all", "All difficulties"]].concat(Q.DIFFICULTIES.map((d) => [d, d]))),
      sel("Filter by type", "type", [["all", "All types"]].concat(Q.TYPES.map((t) => [t.id, t.label]))));
    host.append(tb);

    const info = el("p", "field-hint q-listinfo");
    info.id = "q-listinfo";
    host.append(info);
    const box = el("div", "a-list q-qlist");
    box.id = "q-qlist";
    host.append(box);
    const more = el("div", "a-more");
    const mb = el("button", "btn btn-outline", "Load more");
    mb.type = "button";
    mb.id = "q-more";
    mb.addEventListener("click", () => loadQuestions(false));
    more.append(mb);
    host.append(more);
    fillList();
  }

  /* Re-draw only the rows (keeps the search box focused while typing). */
  function rerenderList() { fillList(); }

  function fillList() {
    const box = document.getElementById("q-qlist");
    if (!box) return;
    const q = S.q;
    clearMath(box);
    box.textContent = "";
    const rows = visibleQuestions();
    if (!q.loaded) box.append(el("div", "a-empty", "Loading\u2026"));
    else if (!rows.length) box.append(el("div", "a-empty", q.rows.length ? "No questions match the search and filters." : "No questions in this chapter yet."));
    else rows.forEach((r) => box.append(qRow(r)));
    document.getElementById("q-listinfo").textContent = q.rows.length ? rows.length + " of " + q.rows.length + " loaded shown, in question-number order." : "";
    document.getElementById("q-more").hidden = q.done || !q.loaded;
    if (rows.length) typeset(box);
  }

  function qRow(r) {
    const row = el("div", "q-qrow");
    const top = el("div", "q-qtop");
    top.append(tag(r.displayId || r.id, "q-id"), tag(Q.typeLabel(r.type)), tag(r.difficulty), tag(marksText(r.marks)),
      el("span", "badge" + (r.status === "published" ? " is-approved" : ""), r.status === "published" ? "Published" : "Draft"));
    const stem = el("div", "q-stem");
    stem.textContent = excerpt(stemText(r));
    let thumb = null;
    if (r.imageUrl) {
      thumb = el("img", "q-thumb");
      thumb.alt = "Question image";
      thumb.loading = "lazy";
      thumb.src = IU.displayUrl(r.imageUrl, 320);
    }
    const acts = el("div", "q-qacts");
    const mk = (label, cls, fn) => {
      const b = el("button", "btn btn-sm " + cls, label);
      b.type = "button";
      b.addEventListener("click", () => fn(b));
      acts.append(b);
    };
    mk("Edit", "btn-outline", () => editQuestion(r));
    mk("Duplicate", "btn-outline", (b) => duplicateQuestion(r, b));
    mk(r.status === "published" ? "Unpublish" : "Publish", "btn-outline", (b) => toggleStatus(r, b));
    mk("Delete", "btn-danger", () => deleteQuestionFlow(r));
    if (thumb) row.append(top, stem, thumb, acts); else row.append(top, stem, acts);
    return row;
  }

  async function editQuestion(r) {
    try {
      const key = await Q.getKey(r.id);
      S.edit = { existing: r, key: key };
      render();
      window.scrollTo(0, 0);
    } catch (err) {
      console.error(err);
      api.notice("Could not open the question. " + api.failText(err), true);
    }
  }

  async function duplicateQuestion(r, btn) {
    btn.disabled = true;
    try {
      const key = await Q.getKey(r.id);
      const hadImages = !!(r.imageUrl || key.explanationImageUrl);
      delete key.explanationImageUrl; delete key.explanationImageFileId; // images are not copied
      const fields = {};
      ["type", "difficulty", "marks", "questionLatex", "assertionLatex", "reasonLatex", "options", "matchLeft", "matchRight", "subQuestions"]
        .forEach((k) => { if (r[k] !== undefined) fields[k] = r[k]; });
      fields.status = "draft";
      const res = await Q.createQuestion(S.chapter, api.adminEmail(), fields, key);
      S.q.rows.push({ ...fields, id: res.id, displayId: res.displayId, serial: res.serial, chapterId: S.chapter.id,
        board: r.board, cls: r.cls, subject: r.subject, levels: r.levels, createdBy: api.adminEmail() });
      fillList();
      api.notice("Duplicated as a draft: " + res.displayId + "." + (hadImages ? " Images are not copied; add them again in the editor." : ""));
    } catch (err) {
      console.error(err);
      api.notice("Duplicate failed. " + api.failText(err), true);
      btn.disabled = false;
    }
  }

  async function toggleStatus(r, btn) {
    const next = r.status === "published" ? "draft" : "published";
    if (next === "published") {
      const issues = [];
      collectStored(r).forEach((p) => validateLatex(p).forEach((i) => { if (i.level === "error") issues.push(i); }));
      if (issues.length) { api.notice("This question has LaTeX errors and cannot be published. Open it with Edit to fix them.", true); return; }
    }
    btn.disabled = true;
    try {
      await Q.setQuestionStatus(r.id, next);
      r.status = next;
      fillList();
      api.notice(r.displayId + (next === "published" ? " published." : " moved back to draft."));
    } catch (err) {
      console.error(err);
      api.notice("Could not change the status. " + api.failText(err), true);
      btn.disabled = false;
    }
  }
  /* All LaTeX strings held on a stored question (for the publish check). */
  function collectStored(r) {
    const out = [r.questionLatex, r.assertionLatex, r.reasonLatex].concat(r.options || [], r.matchLeft || [], r.matchRight || []);
    (r.subQuestions || []).forEach((s) => { out.push(s.questionLatex); (s.options || []).forEach((o) => out.push(o)); });
    return out.filter((x) => typeof x === "string");
  }

  async function deleteQuestionFlow(r) {
    const ok = await api.confirmDialog({
      title: "Permanently delete this question?",
      text: (r.displayId || "This question") + ", its answer key and any attached images will be removed. This cannot be undone.",
      ok: "Delete permanently", danger: true
    });
    if (!ok) return;
    try {
      const key = await Q.getKey(r.id);  // needed to find the explanation image
      await Q.deleteQuestion(r.id);
      S.q.rows = S.q.rows.filter((x) => x.id !== r.id);
      fillList();
      const ids = [r.imageFileId, key.explanationImageFileId].filter(Boolean);
      const failed = ids.length ? await IU.deleteImages(ids) : 0;
      api.notice("Question deleted." + (failed
        ? " " + failed + " image" + (failed === 1 ? "" : "s") + " could not be removed from ImageKit; delete " + (failed === 1 ? "it" : "them") + " from the ImageKit media library."
        : ""), !!failed);
    } catch (err) {
      console.error(err);
      api.notice("Delete failed. " + api.failText(err), true);
    }
  }

  function closeEditor() {
    S.edit = null;
    render();
  }

  /* ───────────────────────── LaTeX fields ───────────────────────── */
  function insertText(ta, text) {
    ta.focus();
    let done = false;
    try { done = document.execCommand("insertText", false, text); } catch (e) { done = false; }
    if (!done) {
      const s = ta.selectionStart, e2 = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(e2);
      ta.setSelectionRange(s + text.length, s + text.length);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function showNote(box, r) {
    box.textContent = "";
    if (r.changes) box.append(el("div", null, "Converted " + r.changes + " item" + (r.changes === 1 ? "" : "s") + " to LaTeX. Please check the preview."));
    r.flags.forEach((f) => box.append(el("div", "is-warn", f)));
    box.hidden = !box.childNodes.length;
  }

  function latexField(label, value, o) {
    o = o || {};
    const wrap = el("div", "q-field");
    const id = "qf" + (++uid);
    if (label) {
      const l = el("label", "field-label", label);
      l.htmlFor = id;
      wrap.append(l);
    }
    if (o.hint) wrap.append(el("p", "field-hint", o.hint));
    const ta = el("textarea", "input q-ta");
    ta.id = id;
    ta.rows = o.rows || 3;
    ta.value = value || "";
    ta.dataset.label = label || "Field";
    ta.spellcheck = true;
    const note = el("div", "q-note"); note.hidden = true;
    const msg = el("div", "q-msg"); msg.hidden = true;
    const prev = el("div", "q-preview"); prev.hidden = true;
    ta._note = note;
    let timer;
    const refresh = (tries) => {
      if (!wrap.isConnected && (tries || 0) < 20) { setTimeout(() => refresh((tries || 0) + 1), 50); return; }
      setPreview(prev, ta.value);
      showIssues(msg, validateLatex(ta.value));
    };
    ta.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 250); });
    ta.addEventListener("focus", () => { activeTA = ta; });
    ta.addEventListener("paste", (e) => {
      const raw = e.clipboardData && e.clipboardData.getData("text/plain");
      if (!raw) return;
      const r = cleanPasted(raw);
      if (r.text === raw && !r.flags.length) return;
      e.preventDefault();
      insertText(ta, r.text);
      showNote(note, r);
    });
    wrap.append(ta, note, msg, prev);
    if (ta.value) refresh(0);
    return { root: wrap, ta: ta, get: () => ta.value.trim() };
  }

  /* ───────────────────────── Image control (Phase 4) ───────────────────────── */
  /* Pasting an image works when its box is focused (click it, then Ctrl+V). */
  document.addEventListener("paste", (e) => {
    const a = document.activeElement;
    const zone = a && a.closest ? a.closest(".q-imgzone") : null;
    if (!zone || !zone._ctl) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && items[i].type.indexOf("image/") === 0) {
        const f = items[i].getAsFile();
        if (f) { e.preventDefault(); zone._ctl.pickFile(f); return; }
      }
    }
  });

  function imageText(err) {
    if (err && err.name === "TypeError") return "Could not reach the image service. Check your connection, and that the Worker is deployed and allows this site address.";
    return "Image service: " + (err && err.message ? err.message : "something went wrong.");
  }

  /* One optional image. Nothing is uploaded until the question is saved. */
  function imageControl(cfg) {
    let cur = cfg.current && cfg.current.url && cfg.current.fileId ? cfg.current : null; // already saved
    let pend = null;      // { blob, objUrl } chosen but not yet uploaded
    let removed = false;  // the saved image is to be removed

    const wrap = el("div", "q-field");
    wrap.append(el("div", "field-label", cfg.label));
    wrap.append(el("p", "field-hint", cfg.hint));
    const zone = el("div", "q-imgzone");
    zone.tabIndex = 0;
    zone.setAttribute("role", "group");
    zone.setAttribute("aria-label", cfg.label + ". Click here and press Ctrl+V to paste an image, or drop a file.");
    const stage = el("div", "q-imgstage");
    const img = el("img", "q-imgprev");
    img.alt = cfg.label + " preview";
    img.hidden = true;
    const empty = el("div", "q-imgempty", "No image. Choose a file, drop one here, or click here and press Ctrl+V to paste.");
    stage.append(img, empty);

    const file = el("input");
    file.type = "file"; file.accept = IU.ACCEPT; file.hidden = true;
    const bar = el("div", "q-imgbtns");
    const mk = (label, cls) => { const b = el("button", "btn btn-sm " + cls, label); b.type = "button"; bar.append(b); return b; };
    const chooseBtn = mk("Choose image", "btn-outline");
    const pasteBtn = mk("Paste image", "btn-outline");
    const removeBtn = mk("Remove", "btn-outline");
    const msg = el("div", "q-msg"); msg.hidden = true;
    zone.append(stage, bar, file);
    wrap.append(zone, msg);
    zone._ctl = null;

    function say(text, isError) {
      msg.textContent = text || "";
      msg.hidden = !text;
      msg.classList.toggle("is-error-text", !!isError);
    }
    function draw() {
      let src = "";
      if (pend) src = pend.objUrl;
      else if (cur && !removed) src = IU.displayUrl(cur.url, 900);
      img.hidden = !src;
      empty.hidden = !!src;
      if (src) img.src = src; else img.removeAttribute("src");
      chooseBtn.textContent = src ? "Replace image" : "Choose image";
      removeBtn.hidden = !src;
    }
    async function pickFile(f) {
      say("");
      try {
        const r = await IU.prepareImage(f);
        if (pend) URL.revokeObjectURL(pend.objUrl);
        pend = { blob: r.blob, objUrl: URL.createObjectURL(r.blob) };
        draw();
        say(r.shrunk ? "The image was larger than 2 MB, so it was shrunk to " + (r.blob.size / 1048576).toFixed(1) + " MB. It uploads when you save the question."
                     : "It uploads when you save the question.");
      } catch (err) {
        say(err.message, true);
      }
    }
    chooseBtn.addEventListener("click", () => file.click());
    file.addEventListener("change", () => { if (file.files[0]) pickFile(file.files[0]); file.value = ""; });
    pasteBtn.addEventListener("click", async () => {
      zone.focus();
      if (!navigator.clipboard || !navigator.clipboard.read) { say("Your browser does not allow this button. Click the box and press Ctrl+V instead.", true); return; }
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const t = it.types.find((x) => x.indexOf("image/") === 0);
          if (t) { const b = await it.getType(t); await pickFile(new File([b], "pasted-image", { type: t })); return; }
        }
        say("There is no image on the clipboard.", true);
      } catch (err) {
        say("Could not read the clipboard. Click the box and press Ctrl+V instead.", true);
      }
    });
    removeBtn.addEventListener("click", () => {
      if (pend) { URL.revokeObjectURL(pend.objUrl); pend = null; }
      if (cur) removed = true;
      say("");
      draw();
    });
    ["dragenter", "dragover"].forEach((n) => zone.addEventListener(n, (e) => { e.preventDefault(); zone.classList.add("is-drag"); }));
    ["dragleave", "drop"].forEach((n) => zone.addEventListener(n, (e) => { e.preventDefault(); zone.classList.remove("is-drag"); }));
    zone.addEventListener("drop", (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) pickFile(f);
    });

    const ctl = {
      root: wrap,
      /* Uploads a newly chosen image (if any) and says what changed. */
      commit: async (folder, baseName) => {
        if (pend) {
          const up = await IU.uploadImage(pend.blob, folder, baseName);
          return { value: up, uploadedId: up.fileId, obsolete: cur ? [cur.fileId] : [] };
        }
        if (removed && cur) return { value: null, uploadedId: null, obsolete: [cur.fileId] };
        return { value: cur, uploadedId: null, obsolete: [] };
      }
    };
    zone._ctl = ctl;
    draw();
    return ctl;
  }

  /* ───────────────────────── List editor (options, answers ...) ───────────────────────── */
  function listEditor(cfg) {
    const root = el("div", "q-list");
    const rows = el("div", "q-rows");
    const add = el("button", "btn btn-outline btn-sm", cfg.addLabel || "Add");
    add.type = "button";
    const sync = () => cfg.items.forEach((m) => { if (m.sync) m.sync(); });
    function render() {
      rows.textContent = "";
      cfg.items.forEach((m, i) => {
        const canRemove = !cfg.fixed && cfg.items.length > cfg.min;
        rows.append(cfg.build(m, i, () => {
          sync();
          if (cfg.onRemove) cfg.onRemove(i);
          cfg.items.splice(i, 1);
          render();
        }, canRemove));
      });
      add.hidden = !!cfg.fixed || cfg.items.length >= cfg.max;
      if (cfg.onChange) cfg.onChange();
    }
    add.addEventListener("click", () => { sync(); cfg.items.push(cfg.blank()); render(); });
    root.append(rows, add);
    render();
    return { root: root, items: cfg.items, sync: sync };
  }

  const removeBtn = (fn) => {
    const b = el("button", "btn btn-outline btn-sm q-remove", "Remove");
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };

  /* ───────────────────────── Answer parts, one per question type ───────────────────────── */
  function mcqPart(multi, d, k, fixedOptions) {
    const root = el("div", "q-part");
    root.append(el("div", "field-label", multi ? "Options (tick every correct option)" : "Options (select the correct option)"));
    const name = "qc" + (++uid);
    const correct = new Set(k.correct || []);
    const base = (d.options && d.options.length) ? d.options : (fixedOptions || ["", "", "", ""]);
    const items = base.map((t, i) => ({ text: t, correct: correct.has(i) }));
    const L = listEditor({
      items: items, min: 2, max: 6, fixed: !!fixedOptions, addLabel: "Add option",
      blank: () => ({ text: "", correct: false }),
      build: (m, i, remove, canRemove) => {
        const row = el("div", "q-opt");
        const mark = el("input", "check");
        mark.type = multi ? "checkbox" : "radio";
        mark.name = name;
        mark.checked = m.correct;
        mark.setAttribute("aria-label", "Option " + letter(i) + " is correct");
        const f = latexField("Option " + letter(i), m.text, { rows: 2 });
        m.sync = () => { m.text = f.get(); m.correct = mark.checked; };
        row.append(mark, f.root);
        if (canRemove) row.append(removeBtn(remove));
        return row;
      }
    });
    root.append(L.root);
    return {
      root: root,
      collect: () => {
        L.sync();
        const errors = [];
        const texts = L.items.map((m) => m.text.trim());
        if (texts.some((t) => !t)) errors.push("Every option needs text.");
        const correctIdx = [];
        L.items.forEach((m, i) => { if (m.correct) correctIdx.push(i); });
        if (!correctIdx.length) errors.push(multi ? "Tick at least one correct option." : "Select the correct option.");
        return { q: { options: texts }, k: { correct: correctIdx }, errors: errors };
      }
    };
  }

  function trueFalsePart(d, k) {
    const root = el("div", "q-part");
    root.append(el("div", "field-label", "Correct answer"));
    const name = "qt" + (++uid);
    const choices = el("div", "choices");
    const inputs = [];
    ["True", "False"].forEach((t, i) => {
      const lab = el("label", "choice");
      const inp = el("input");
      inp.type = "radio"; inp.name = name; inp.value = String(i);
      inp.checked = !!(k.correct && k.correct[0] === i);
      inputs.push(inp);
      lab.append(inp, el("span", null, t));
      choices.append(lab);
    });
    root.append(choices);
    return {
      root: root,
      collect: () => {
        const sel = inputs.findIndex((x) => x.checked);
        return { q: {}, k: sel === -1 ? {} : { correct: [sel] }, errors: sel === -1 ? ["Choose True or False as the correct answer."] : [] };
      }
    };
  }

  function fillPart(d, k) {
    const root = el("div", "q-part");
    root.append(el("div", "field-label", "Accepted answers"));
    root.append(el("p", "field-hint", "Use ____ (underscores) in the question to mark the blank. Add every accepted answer or spelling."));
    const items = ((k.acceptedAnswers && k.acceptedAnswers.length) ? k.acceptedAnswers : [""]).map((t) => ({ text: t }));
    const L = listEditor({
      items: items, min: 1, max: 8, addLabel: "Add another accepted answer",
      blank: () => ({ text: "" }),
      build: (m, i, remove, canRemove) => {
        const row = el("div", "q-opt q-opt-plain");
        const inp = el("input", "input");
        inp.type = "text"; inp.maxLength = 200; inp.value = m.text; inp.autocomplete = "off";
        inp.setAttribute("aria-label", "Accepted answer " + (i + 1));
        m.sync = () => { m.text = inp.value; };
        row.append(inp);
        if (canRemove) row.append(removeBtn(remove));
        return row;
      }
    });
    root.append(L.root);
    return {
      root: root,
      collect: () => {
        L.sync();
        const seen = {}, list = [];
        L.items.forEach((m) => { const t = m.text.trim(); if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = 1; list.push(t); } });
        return { q: {}, k: { acceptedAnswers: list }, errors: list.length ? [] : ["Enter at least one accepted answer."] };
      }
    };
  }

  function numericalPart(d, k) {
    const root = el("div", "q-part q-numrow");
    const a = el("div", "field");
    a.append(el("label", "field-label", "Correct numerical answer"));
    const v = el("input", "input");
    v.type = "number"; v.step = "any";
    v.value = (typeof k.numericAnswer === "number") ? String(k.numericAnswer) : "";
    a.lastChild.htmlFor = (v.id = "qn" + (++uid));
    a.append(v);
    const b = el("div", "field");
    b.append(el("label", "field-label", "Tolerance (optional)"));
    const t = el("input", "input");
    t.type = "number"; t.step = "any"; t.min = "0";
    t.value = (typeof k.tolerance === "number") ? String(k.tolerance) : "0";
    b.lastChild.htmlFor = (t.id = "qn" + (++uid));
    b.append(t, el("p", "field-hint", "Answers within this distance of the correct value will count as correct. 0 means an exact match."));
    root.append(a, b);
    return {
      root: root,
      collect: () => {
        const errors = [];
        const val = parseFloat(v.value);
        const tol = t.value.trim() === "" ? 0 : parseFloat(t.value);
        if (!isFinite(val)) errors.push("Enter the correct numerical answer.");
        if (!isFinite(tol) || tol < 0) errors.push("Tolerance must be 0 or more.");
        return { q: {}, k: { numericAnswer: isFinite(val) ? val : 0, tolerance: (isFinite(tol) && tol >= 0) ? tol : 0 }, errors: errors };
      }
    };
  }

  function writtenPart(d, k) {
    const root = el("div", "q-part");
    const f = latexField("Model answer", k.modelAnswerLatex, {
      rows: 5, hint: "Students compare their own answer with this one. Written answers are self-assessed and are not auto-scored."
    });
    root.append(f.root);
    return {
      root: root,
      collect: () => {
        const t = f.get();
        return { q: {}, k: { modelAnswerLatex: t }, errors: t ? [] : ["Enter the model answer."] };
      }
    };
  }

  function assertionPart(d, k) {
    const root = el("div", "q-part");
    const a = latexField("Assertion (A)", d.assertionLatex, { rows: 3 });
    const r = latexField("Reason (R)", d.reasonLatex, { rows: 3 });
    const m = mcqPart(false, d, k, Q.AR_OPTIONS);
    root.append(a.root, r.root, m.root);
    return {
      root: root,
      collect: () => {
        const errors = [];
        const A = a.get(), R = r.get();
        if (!A) errors.push("Assertion (A) is required.");
        if (!R) errors.push("Reason (R) is required.");
        const p = m.collect();
        return { q: { assertionLatex: A, reasonLatex: R, options: p.q.options }, k: p.k, errors: errors.concat(p.errors) };
      }
    };
  }

  function matchPart(d, k) {
    const root = el("div", "q-part");
    const left = ((d.matchLeft && d.matchLeft.length) ? d.matchLeft : ["", ""]).map((t, i) => ({
      text: t, map: (k.matchMap && Number.isInteger(k.matchMap[i])) ? k.matchMap[i] : ""
    }));
    const right = ((d.matchRight && d.matchRight.length) ? d.matchRight : ["", ""]).map((t) => ({ text: t }));
    const mapBox = el("div", "q-map");
    function renderMap() {
      mapBox.textContent = "";
      left.forEach((m, i) => {
        const r = el("div", "q-maprow");
        r.append(el("span", "q-maplabel", "Item " + (i + 1) + " matches"));
        const sel = el("select", "input");
        sel.setAttribute("aria-label", "Correct match for item " + (i + 1));
        const o0 = el("option", null, "Choose"); o0.value = ""; sel.append(o0);
        right.forEach((_, j) => { const o = el("option", null, letter(j)); o.value = String(j); sel.append(o); });
        sel.value = m.map === "" ? "" : String(m.map);
        sel.addEventListener("change", () => { m.map = sel.value === "" ? "" : parseInt(sel.value, 10); });
        r.append(sel);
        mapBox.append(r);
      });
    }
    const colBuild = (label, num) => (m, i, remove, canRemove) => {
      const row = el("div", "q-opt");
      row.append(el("span", "q-itemlabel", num ? String(i + 1) : letter(i)));
      const f = latexField(null, m.text, { rows: 2 });
      f.ta.setAttribute("aria-label", label + " " + (num ? i + 1 : letter(i)));
      f.ta.dataset.label = label + " " + (num ? i + 1 : letter(i));
      m.sync = () => { m.text = f.get(); };
      row.append(f.root);
      if (canRemove) row.append(removeBtn(remove));
      return row;
    };
    const L = listEditor({ items: left, min: 2, max: 8, addLabel: "Add left item", blank: () => ({ text: "", map: "" }),
      build: colBuild("Left item", true), onChange: renderMap });
    const R = listEditor({ items: right, min: 2, max: 8, addLabel: "Add right item", blank: () => ({ text: "" }),
      build: colBuild("Right item", false),
      onRemove: (i) => left.forEach((m) => { if (m.map === i) m.map = ""; else if (m.map !== "" && m.map > i) m.map -= 1; }),
      onChange: renderMap });
    root.append(el("div", "field-label", "Column I (left items)"), L.root,
      el("div", "field-label q-gap", "Column II (right items)"), R.root,
      el("div", "field-label q-gap", "Correct matches"), mapBox);
    renderMap();
    return {
      root: root,
      collect: () => {
        L.sync(); R.sync();
        const errors = [];
        if (left.some((m) => !m.text.trim()) || right.some((m) => !m.text.trim())) errors.push("Every left and right item needs text.");
        if (left.some((m) => m.map === "")) errors.push("Choose the correct match for every left item.");
        return {
          q: { matchLeft: left.map((m) => m.text.trim()), matchRight: right.map((m) => m.text.trim()) },
          k: { matchMap: left.map((m) => (m.map === "" ? 0 : m.map)) },
          errors: errors
        };
      }
    };
  }

  /* Question text + the answer part for one (non case-based) question. */
  function buildBody(type, d, k, label) {
    d = d || {}; k = k || {};
    const root = el("div", "q-body");
    let qf = null;
    if (type !== "assertion_reason") {
      qf = latexField(label || "Question", d.questionLatex, { rows: type === "long" ? 4 : 3 });
      root.append(qf.root);
    }
    let part;
    if (type === "mcq_single") part = mcqPart(false, d, k);
    else if (type === "mcq_multi") part = mcqPart(true, d, k);
    else if (type === "true_false") part = trueFalsePart(d, k);
    else if (type === "fill_blank") part = fillPart(d, k);
    else if (type === "numerical") part = numericalPart(d, k);
    else if (type === "assertion_reason") part = assertionPart(d, k);
    else if (type === "match") part = matchPart(d, k);
    else part = writtenPart(d, k);
    root.append(part.root);
    return {
      root: root,
      collect: () => {
        const errors = [];
        const q = {};
        if (qf) {
          q.questionLatex = qf.get();
          if (!q.questionLatex) errors.push((label || "Question") + " text is required.");
        } else q.questionLatex = "";
        const p = part.collect();
        return { q: { ...q, ...p.q }, k: p.k, errors: errors.concat(p.errors) };
      }
    };
  }

  /* Case-based: a passage plus 1 to 6 sub-questions; marks are the sum. */
  function caseBody(d, k) {
    d = d || {}; k = k || {};
    const root = el("div", "q-body");
    const passage = latexField("Passage / case", d.questionLatex, { rows: 6 });
    root.append(passage.root);
    const subs = (d.subQuestions && d.subQuestions.length ? d.subQuestions : [{ type: "mcq_single", marks: 1 }]).map((s, i) => ({
      type: s.type, d: s, k: (k.subKeys && k.subKeys[i]) || {}, marks: s.marks
    }));
    const list = el("div", "q-subs");
    const total = el("div", "q-total");
    const addBtn = el("button", "btn btn-outline btn-sm", "Add sub-question");
    addBtn.type = "button";
    function updateTotal() {
      let sum = 0;
      subs.forEach((s) => { const n = parseMarks(s.marksInput ? s.marksInput.value : s.marks); if (!isNaN(n)) sum += n; });
      total.textContent = "Total marks: " + sum + " (the sum of the sub-question marks)";
    }
    function snapshot() {
      subs.forEach((s) => {
        if (!s.body) return;
        const r = s.body.collect();
        s.d = r.q; s.k = r.k; s.marks = s.marksInput.value;
      });
    }
    function renderSubs() {
      clearMath(list);
      list.textContent = "";
      subs.forEach((s, i) => {
        const card = el("div", "q-sub");
        const hd = el("div", "q-subhead");
        hd.append(el("h4", null, "Sub-question " + (i + 1)));
        const type = el("select", "input");
        type.setAttribute("aria-label", "Type of sub-question " + (i + 1));
        Q.SUB_TYPES.forEach((t) => { const o = el("option", null, Q.typeLabel(t)); o.value = t; type.append(o); });
        type.value = s.type;
        type.addEventListener("change", () => { snapshot(); s.type = type.value; s.d = { questionLatex: (s.d && s.d.questionLatex) || "" }; s.k = {}; renderSubs(); });
        const mk = el("input", "input q-marks");
        mk.type = "number"; mk.step = "0.5"; mk.min = "0.5"; mk.max = "100";
        mk.value = (s.marks === undefined || s.marks === null) ? "" : String(s.marks);
        mk.setAttribute("aria-label", "Marks for sub-question " + (i + 1));
        mk.placeholder = "Marks";
        mk.addEventListener("input", updateTotal);
        s.marksInput = mk;
        hd.append(type, mk);
        if (subs.length > 1) hd.append(removeBtn(() => { snapshot(); subs.splice(i, 1); renderSubs(); }));
        card.append(hd);
        s.body = buildBody(s.type, s.d, s.k, "Sub-question " + (i + 1));
        card.append(s.body.root);
        list.append(card);
      });
      addBtn.hidden = subs.length >= 6;
      updateTotal();
    }
    addBtn.addEventListener("click", () => { snapshot(); subs.push({ type: "mcq_single", d: {}, k: {}, marks: 1 }); renderSubs(); });
    root.append(el("div", "field-label q-gap", "Sub-questions"), list, addBtn);
    renderSubs();
    return {
      root: root, isCase: true, totalNode: total,
      collect: () => {
        const errors = [];
        const pass = passage.get();
        if (!pass) errors.push("The passage is required.");
        const subQ = [], subK = [];
        let sum = 0;
        subs.forEach((s, i) => {
          const r = s.body.collect();
          r.errors.forEach((e) => errors.push("Sub-question " + (i + 1) + ": " + e));
          const m = parseMarks(s.marksInput.value);
          if (isNaN(m)) errors.push("Sub-question " + (i + 1) + ": marks must be a positive number in steps of 0.5 (up to 100).");
          else sum += m;
          subQ.push({ type: s.type, marks: isNaN(m) ? 0 : m, ...r.q });
          subK.push(r.k);
        });
        return { q: { questionLatex: pass, subQuestions: subQ, marks: sum }, k: { subKeys: subK }, errors: errors };
      }
    };
  }

  /* ───────────────────────── Symbol toolbar ───────────────────────── */
  function buildToolbar() {
    const bar = el("div", "q-symbar");
    const tabs = el("div", "q-symtabs");
    const grid = el("div", "q-symgrid");
    const hint = el("div", "q-symhint", "Click inside a field, then choose a symbol. Pasted text is converted to LaTeX automatically.");
    const tabBtns = [];
    function show(gi) {
      tabBtns.forEach((b, i) => b.setAttribute("aria-selected", String(i === gi)));
      grid.textContent = "";
      SYMBOL_GROUPS[gi].items.forEach((it) => {
        const b = el("button", "q-sym", it.label);
        b.type = "button";
        b.title = it.tex.replace("|", "");
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => {
          if (!activeTA || !activeTA.isConnected) { hint.textContent = "Click inside a text field first, then choose a symbol."; return; }
          insertSnippet(activeTA, it.tex, it.raw);
        });
        grid.append(b);
      });
    }
    SYMBOL_GROUPS.forEach((g, gi) => {
      const t = el("button", "q-symtab", g.name);
      t.type = "button";
      t.setAttribute("role", "tab");
      t.addEventListener("mousedown", (e) => e.preventDefault());
      t.addEventListener("click", () => show(gi));
      tabBtns.push(t);
      tabs.append(t);
    });
    const clean = el("button", "btn btn-outline btn-sm q-clean", "Convert field to LaTeX");
    clean.type = "button";
    clean.title = "Converts Unicode symbols, superscripts, subscripts and chemical formulae already typed in the selected field";
    clean.addEventListener("mousedown", (e) => e.preventDefault());
    clean.addEventListener("click", () => {
      if (!activeTA || !activeTA.isConnected) { hint.textContent = "Click inside a text field first."; return; }
      const r = cleanPasted(activeTA.value);
      activeTA.focus();
      activeTA.select();
      insertText(activeTA, r.text);
      showNote(activeTA._note, r);
      hint.textContent = r.changes ? "Converted " + r.changes + " item" + (r.changes === 1 ? "" : "s") + " in the selected field." : "Nothing to convert in the selected field.";
    });
    const top = el("div", "q-symtop");
    top.append(tabs, clean);
    bar.append(top, grid, hint);
    show(0);
    return bar;
  }

  /* ───────────────────────── Editor ───────────────────────── */
  function renderEditor() {
    const existing = S.edit.existing;
    const key = S.edit.key || {};
    const chapter = S.chapter;
    activeTA = null;

    const h = head(existing ? "Edit question" : "New question",
      "Chapter " + chapter.chapterNumber + ": " + chapter.chapterName + " \u00b7 " + S.board + " \u00b7 Class " + S.cls + " \u00b7 " + S.subject);
    host.append(h);
    const idLine = el("p", "field-hint", existing
      ? "Question ID " + existing.displayId + ". Status: " + (existing.status === "published" ? "Published" : "Draft") + ". The question type and chapter cannot be changed; to move a question, create it again in the other chapter."
      : "The question ID is assigned when you save.");
    idLine.style.marginBottom = "16px";
    host.append(idLine);
    host.append(buildToolbar());

    const form = el("div", "q-form");

    /* Type */
    const typeWrap = el("div", "field");
    typeWrap.append(el("label", "field-label", "Question type"));
    const typeSel = el("select", "input");
    typeSel.id = "q-type";
    typeWrap.lastChild.htmlFor = "q-type";
    Q.TYPES.forEach((t) => { const o = el("option", null, t.label); o.value = t.id; typeSel.append(o); });
    typeSel.value = existing ? existing.type : "mcq_single";
    typeSel.disabled = !!existing;
    const typeHint = el("p", "field-hint");
    typeWrap.append(typeSel, typeHint);

    /* Difficulty */
    const diffWrap = el("div", "field");
    diffWrap.append(el("div", "field-label", "Difficulty"));
    const diffChoices = el("div", "choices");
    const diffName = "qd" + (++uid);
    const diffInputs = Q.DIFFICULTIES.map((dname) => {
      const lab = el("label", "choice");
      const inp = el("input");
      inp.type = "radio"; inp.name = diffName; inp.value = dname;
      inp.checked = !!(existing && existing.difficulty === dname);
      lab.append(inp, el("span", null, dname));
      diffChoices.append(lab);
      return inp;
    });
    diffWrap.append(diffChoices);

    /* Marks */
    const marksWrap = el("div", "field");
    const marksLabel = el("label", "field-label", "Marks");
    const marksInput = el("input", "input q-marks-input");
    marksInput.id = "q-marks";
    marksLabel.htmlFor = "q-marks";
    marksInput.type = "number"; marksInput.step = "0.5"; marksInput.min = "0.5"; marksInput.max = "100";
    marksInput.value = existing && typeof existing.marks === "number" ? String(existing.marks) : "";
    const marksSlot = el("div");
    marksWrap.append(marksLabel, marksSlot);

    const meta = el("div", "q-meta");
    meta.append(diffWrap, marksWrap);

    const bodyHost = el("div");
    let body = null;
    let bodyType = null;
    function buildFor(type, useExisting) {
      const d = useExisting && existing && existing.type === type ? existing : {};
      const k = useExisting && existing && existing.type === type ? key : {};
      body = type === "case_based" ? caseBody(d, k) : buildBody(type, d, k);
      bodyType = type;
      clearMath(bodyHost);
      bodyHost.textContent = "";
      bodyHost.append(body.root);
      marksSlot.textContent = "";
      marksLabel.hidden = !!body.isCase;
      if (body.isCase) marksSlot.append(body.totalNode);
      else marksSlot.append(marksInput);
      const t = Q.TYPES.find((x) => x.id === type);
      typeHint.textContent = t.auto ? "Marked automatically." : "Written answer: students self-assess against your model answer; not auto-scored.";
    }
    buildFor(typeSel.value, true);
    typeSel.addEventListener("change", () => buildFor(typeSel.value, false));

    const IMG_HINT = "One image. JPG, PNG or WebP; larger files are shrunk to under 2 MB automatically.";
    const stemImg = imageControl({
      label: "Question image (optional)", hint: IMG_HINT + " Shown with the question.",
      current: existing ? { url: existing.imageUrl, fileId: existing.imageFileId } : null
    });
    form.append(typeWrap, meta, stemImg.root, bodyHost);
    const expl = latexField("Explanation (optional)", key.explanationLatex, {
      rows: 4, hint: "Shown to students together with the answer after they attempt the question."
    });
    const explImg = imageControl({
      label: "Explanation image (optional)", hint: IMG_HINT + " Shown with the explanation, after the answer is released.",
      current: { url: key.explanationImageUrl, fileId: key.explanationImageFileId }
    });
    form.append(expl.root, explImg.root);
    host.append(form);

    /* Errors and buttons */
    const errBox = el("div", "portal-error"); errBox.hidden = true; errBox.setAttribute("role", "alert");
    const actions = el("div", "a-actions q-saveacts");
    const draftBtn = el("button", "btn btn-outline", "Save as draft");
    const pubBtn = el("button", "btn btn-primary", "Publish");
    const cancelBtn = el("button", "btn btn-outline", "Cancel");
    [draftBtn, pubBtn, cancelBtn].forEach((b) => { b.type = "button"; });
    actions.append(cancelBtn, el("span", "spacer"), draftBtn, pubBtn);
    host.append(errBox, actions);

    cancelBtn.addEventListener("click", closeEditor);

    function showErrors(list) {
      errBox.textContent = "";
      if (list.length === 1) errBox.textContent = list[0];
      else { errBox.append(el("div", null, "Please fix the following:")); const ul = el("ul"); list.forEach((e) => ul.append(el("li", null, e))); errBox.append(ul); }
      errBox.hidden = !list.length;
      if (list.length) errBox.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    function gather() {
      const errors = [];
      const diff = diffInputs.find((x) => x.checked);
      if (!diff) errors.push("Choose a difficulty.");
      const part = body.collect();
      errors.push(...part.errors);
      let marks;
      if (body.isCase) marks = part.q.marks;
      else {
        marks = parseMarks(marksInput.value);
        if (isNaN(marks)) errors.push("Marks must be a positive number in steps of 0.5 (up to 100).");
      }
      const fields = { ...part.q, type: bodyType, difficulty: diff ? diff.value : "", marks: marks };
      const keys = { ...part.k, explanationLatex: expl.get() };
      /* LaTeX problems across every field in the editor */
      const latexErrors = [];
      host.querySelectorAll("textarea.q-ta").forEach((ta) => {
        validateLatex(ta.value).forEach((i) => { if (i.level === "error") latexErrors.push((ta.dataset.label || "Field") + ": " + i.message); });
      });
      return { errors: errors, fields: fields, keys: keys, latexErrors: latexErrors };
    }

    async function save(status) {
      const g = gather();
      if (g.errors.length) { showErrors(g.errors); return; }
      if (status === "published" && g.latexErrors.length) {
        showErrors(["This question cannot be published until the LaTeX problems are fixed. You can save it as a draft meanwhile."].concat(g.latexErrors));
        return;
      }
      showErrors([]);
      [draftBtn, pubBtn, cancelBtn].forEach((b) => { b.disabled = true; });
      const uploaded = [];   // images uploaded in this save (removed again if the save fails)
      let stage = "images";  // "images" while uploading, "save" once writing to the database
      let obsolete = [];     // replaced or removed images (deleted once the save succeeds)
      try {
        const folder = IU.folderFor(chapter);
        const stemRes = await stemImg.commit(folder, "question");
        if (stemRes.uploadedId) uploaded.push(stemRes.uploadedId);
        const explRes = await explImg.commit(folder, "explanation");
        if (explRes.uploadedId) uploaded.push(explRes.uploadedId);
        obsolete = stemRes.obsolete.concat(explRes.obsolete);
        g.keys.explanationImageUrl = explRes.value ? explRes.value.url : null;
        g.keys.explanationImageFileId = explRes.value ? explRes.value.fileId : null;
        const fields = { ...g.fields, status: status,
          imageUrl: stemRes.value ? stemRes.value.url : null, imageFileId: stemRes.value ? stemRes.value.fileId : null };
        stage = "save";
        let rowId;
        if (existing) {
          await Q.saveQuestion(existing, fields, g.keys);
          Object.assign(existing, fields);
          rowId = existing.id;
        } else {
          const res = await Q.createQuestion(chapter, api.adminEmail(), fields, g.keys);
          S.q.rows.push({ ...fields, id: res.id, displayId: res.displayId, serial: res.serial, chapterId: chapter.id,
            board: chapter.board, cls: chapter.cls, subject: chapter.subject,
            levels: Q.levelsFor(chapter.board, chapter.cls, chapter.subject), createdBy: api.adminEmail() });
          rowId = res.id;
          if (typeof chapter.count === "number") chapter.count += 1;
        }
        S.edit = null;
        render();
        const failedDeletes = obsolete.length ? await IU.deleteImages(obsolete) : 0;
        const row = S.q.rows.find((x) => x.id === rowId);
        api.notice((row ? row.displayId : "Question") + (status === "published" ? " saved and published." : " saved as a draft.")
          + (status === "draft" && g.latexErrors.length ? " Some LaTeX problems remain; fix them before publishing." : "")
          + (failedDeletes ? " The question was saved, but " + failedDeletes + " old image" + (failedDeletes === 1 ? "" : "s")
            + " could not be removed from ImageKit; delete " + (failedDeletes === 1 ? "it" : "them") + " from the ImageKit media library." : ""),
          !!failedDeletes);
        window.scrollTo(0, 0);
      } catch (err) {
        console.error(err);
        if (uploaded.length) await IU.deleteImages(uploaded);   // undo uploads made for this failed save
        showErrors([stage === "images" ? imageText(err) : "Could not save. " + api.failText(err)]);
        [draftBtn, pubBtn, cancelBtn].forEach((b) => { b.disabled = false; });
      }
    }
    draftBtn.addEventListener("click", () => save("draft"));
    pubBtn.addEventListener("click", () => save("published"));
  }

  /* Start at the board folders. */
  render();
  return { reset: () => goTo(0) };
}
