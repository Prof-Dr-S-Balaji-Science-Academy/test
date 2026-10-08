/* ─────────────────────────────────────────────────────────────────────
 * bulk-upload.js  (ES module, ProfAdmin "Bulk upload", Phase 5)
 * The screen and the database side of the Excel import:
 *   1. download the template
 *   2. choose the filled Excel file (and, optionally, the image files)
 *   3. check: every row is validated, chapters are matched, duplicates and
 *      missing images are flagged; NOTHING is saved
 *   4. confirm: images are uploaded and the valid questions are saved
 * The spreadsheet rules live in bulk-core.js. Everything here is cosmetic
 * as far as security goes; the real lock is Firestore Rules v5.
 * ───────────────────────────────────────────────────────────────────── */
import * as Q from "./question-core.js";
import * as IU from "./image-upload.js";
import * as B from "./bulk-core.js";
import { validateLatex } from "./latex-tools.js";

const EXCELJS_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const CHUNK = 25;   // questions saved per step (images are uploaded for one step at a time)

const cfg = {
  TYPES: Q.TYPES, SUB_TYPES: Q.SUB_TYPES, AR_OPTIONS: Q.AR_OPTIONS, DIFFICULTIES: Q.DIFFICULTIES,
  FOLDERS: Q.FOLDERS, levelsFor: Q.levelsFor, typeLabel: Q.typeLabel, validateLatex: validateLatex
};

/* ── The Excel library is loaded only when this screen is opened ── */
let excelPromise = null;
function loadExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelPromise) {
    excelPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = EXCELJS_URL;
      s.onload = () => (window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error("The spreadsheet tool did not start.")));
      s.onerror = () => { excelPromise = null; reject(new Error("The spreadsheet tool could not be loaded. Check your internet connection and try again.")); };
      document.head.append(s);
    });
  }
  return excelPromise;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

/* ───────────────────────── Checking a file ───────────────────────── */

/* Reads the file, then matches chapters, images and duplicates.
 * Returns { fileErrors, entries } where every entry has state
 * "ready" | "duplicate" | "error". Saves nothing. */
async function checkFile(file, imageFiles) {
  const ExcelJS = await loadExcel();
  const res = await B.readUpload(ExcelJS, cfg, await file.arrayBuffer());
  if (res.entries.length > B.MAX_QUESTIONS) return { fileErrors: res.fileErrors, entries: [] };
  const entries = res.entries;

  /* Chapters: board + class + subject + chapter number → one chapter */
  const folderCache = {};
  const chaptersOf = (e) => {
    const key = e.board + "|" + e.cls + "|" + e.subject;
    if (!folderCache[key]) folderCache[key] = Q.fetchChapters(e.board, e.cls, e.subject);
    return folderCache[key];
  };
  for (const e of entries) {
    if (e.state === "error") continue;
    const list = (await chaptersOf(e)).filter((c) => c.chapterNumber === e.chapterNumber);
    if (!list.length) {
      e.errs.push("Chapter " + e.chapterNumber + " does not exist in " + e.board + ", Class " + e.cls + ", " + e.subject + ". Create the chapter in the Questions section first.");
    } else if (list.length > 1) {
      e.errs.push("More than one chapter in " + e.board + ", Class " + e.cls + ", " + e.subject + " has the number " + e.chapterNumber
        + ", so this row cannot be matched to one chapter. Give the chapters different numbers first.");
    } else e.chapter = list[0];
  }

  /* Images: every named file must have been chosen with the Excel file */
  const byName = new Map();
  imageFiles.forEach((f) => byName.set(f.name.toLowerCase(), f));
  entries.forEach((e) => {
    [["Question Image File", e.qImg], ["Explanation Image File", e.eImg]].forEach((p) => {
      if (!p[1]) return;
      const f = byName.get(p[1].toLowerCase());
      if (!f) e.errs.push(p[0] + ": the image \"" + p[1] + "\" was not chosen in step 3.");
      else if (IMAGE_TYPES.indexOf(f.type) === -1) e.errs.push(p[0] + ": \"" + p[1] + "\" must be a JPG, PNG or WebP image.");
    });
    if (e.errs.length) e.state = "error";
  });

  /* Duplicates: same question text in the same chapter (already saved, or earlier in this file) */
  const existing = {};
  const existingFor = (chapterId) => {
    if (!existing[chapterId]) {
      existing[chapterId] = Q.fetchAllQuestions(chapterId).then((rows) => {
        const m = new Map();
        rows.forEach((r) => { const k = B.stemKey(r); if (k && !m.has(k)) m.set(k, r.displayId || r.id); });
        return m;
      });
    }
    return existing[chapterId];
  };
  const seen = new Map();
  for (const e of entries) {
    if (e.state !== "ready" || !e.chapter || !e.stem) continue;
    const saved = (await existingFor(e.chapter.id)).get(e.stem);
    const mark = e.chapter.id + "|" + e.stem;
    if (saved) { e.state = "duplicate"; e.dupNote = "The same question text is already saved in this chapter (" + saved + ")."; }
    else if (seen.has(mark)) { e.state = "duplicate"; e.dupNote = "The same question text appears earlier in this file (" + seen.get(mark) + ")."; }
    else seen.set(mark, e.label);
  }
  return { fileErrors: res.fileErrors, entries: entries };
}

/* ───────────────────────── Saving ───────────────────────── */

async function uploadImages(e, folder, imageMap) {
  const ids = [];
  const out = { fields: { ...e.fields }, keys: { ...e.keys } };
  try {
    if (e.qImg) {
      const p = await IU.prepareImage(imageMap.get(e.qImg.toLowerCase()));
      const r = await IU.uploadImage(p.blob, folder, "question");
      ids.push(r.fileId);
      out.fields.imageUrl = r.url; out.fields.imageFileId = r.fileId;
    }
    if (e.eImg) {
      const p = await IU.prepareImage(imageMap.get(e.eImg.toLowerCase()));
      const r = await IU.uploadImage(p.blob, folder, "explanation");
      ids.push(r.fileId);
      out.keys.explanationImageUrl = r.url; out.keys.explanationImageFileId = r.fileId;
    }
  } catch (err) {
    if (ids.length) await IU.deleteImages(ids);
    throw err;
  }
  return { out: out, ids: ids };
}

/* Saves the entries chapter by chapter. Images are uploaded for each step first.
 * A step is saved completely or not at all; if one fails the import stops, the
 * step's images are removed again, and the result says exactly what was saved. */
async function runImport(list, imageMap, adminEmail, onProgress) {
  const groups = [];
  const byChapter = {};
  list.forEach((e) => {
    if (!byChapter[e.chapter.id]) { byChapter[e.chapter.id] = { chapter: e.chapter, items: [] }; groups.push(byChapter[e.chapter.id]); }
    byChapter[e.chapter.id].items.push(e);
  });
  const result = { saved: 0, failed: [], stopped: false, strayImages: 0 };
  const savedSet = new Set();
  let done = 0;
  for (const g of groups) {
    const folder = IU.folderFor(g.chapter);
    for (let i = 0; i < g.items.length; i += CHUNK) {
      const chunk = g.items.slice(i, i + CHUNK);
      const ready = [], ids = [];
      for (const e of chunk) {
        try {
          const u = await uploadImages(e, folder, imageMap);
          ready.push({ e: e, fields: u.out.fields, keys: u.out.keys });
          u.ids.forEach((x) => ids.push(x));
        } catch (err) {
          console.error(err);
          result.failed.push({ e: e, reason: "The image could not be uploaded (" + (err && err.message ? err.message : "unknown error") + "). This question was not saved." });
        }
        onProgress(done + ready.length, list.length, "Preparing " + g.chapter.chapterName);
      }
      try {
        await Q.createQuestionsBulk(g.chapter.id, adminEmail, ready.map((r) => ({ fields: r.fields, keys: r.keys })));
        result.saved += ready.length;
        ready.forEach((r) => savedSet.add(r.e));
        done += chunk.length;
        onProgress(done, list.length, "Saved " + result.saved + " of " + list.length);
      } catch (err) {
        console.error(err);
        if (ids.length) result.strayImages += await IU.deleteImages(ids);
        const why = err && err.code === "permission-denied"
          ? "Permission was refused. Check that the latest Firestore rules (v5) are published."
          : "The database could not be reached or refused the save.";
        ready.forEach((r) => result.failed.push({ e: r.e, reason: why + " This question was not saved." }));
        result.stopped = true;
        break;
      }
    }
    if (result.stopped) break;
  }
  if (result.stopped) {
    const handled = new Set(result.failed.map((f) => f.e));
    list.forEach((e) => {
      if (!savedSet.has(e) && !handled.has(e)) result.failed.push({ e: e, reason: "The import stopped before this question was reached. It was not saved." });
    });
  }
  return result;
}

/* ───────────────────────── The screen ───────────────────────── */

/* o: { el, api, head(title, sub), onClose(changed) } */
export function renderBulkUpload(host, o) {
  const el = o.el, api = o.api;
  const st = { file: null, images: [], result: null, busy: false, includeDups: false, outcome: null };

  host.append(o.head("Bulk upload",
    "Add many questions at once from an Excel file. Nothing is saved until you have seen the check report and confirmed."));

  const wrap = el("div", "bu-wrap");
  host.append(wrap);

  const card = (title, text) => {
    const c = el("section", "bu-card");
    c.append(el("h3", null, title));
    if (text) c.append(el("p", "field-hint", text));
    wrap.append(c);
    return c;
  };
  const button = (label, cls, fn) => {
    const b = el("button", "btn " + cls, label);
    b.type = "button";
    b.addEventListener("click", () => fn(b));
    return b;
  };
  const guard = (e) => { if (st.busy) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", guard);
  const release = () => { window.removeEventListener("beforeunload", guard); };
  /* If the user leaves this screen the listener is dropped on the next render. */
  host._bulkRelease = release;

  /* Step 1: template */
  const c1 = card("1. Download the template",
    "One Excel file with a sheet for each kind of question (Objective, Match, Case-based, Written), dropdown lists, an instructions sheet, example rows and a list of your current chapters. Up to " + B.MAX_QUESTIONS + " questions per upload.");
  const tplBtn = button("Download template", "btn-outline", async (b) => {
    b.disabled = true;
    const old = b.textContent;
    b.textContent = "Preparing\u2026";
    try {
      const ExcelJS = await loadExcel();
      const folders = [];
      Q.FOLDERS.forEach((f) => f.subjects.forEach((s) => folders.push({ board: f.board, cls: f.cls, subject: s, chapters: [] })));
      await Promise.all(folders.map(async (f) => { f.chapters = await Q.fetchChapters(f.board, f.cls, f.subject); }));
      const wb = B.buildTemplate(ExcelJS, cfg, folders);
      saveBlob(new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_MIME }), "question-upload-template.xlsx");
    } catch (err) {
      console.error(err);
      api.notice("The template could not be prepared. " + (err && err.message && /spreadsheet/.test(err.message) ? err.message : api.failText(err)), true);
    }
    b.textContent = old;
    b.disabled = false;
  });
  c1.append(tplBtn);

  /* Step 2: the filled file */
  const c2 = card("2. Choose your filled Excel file", "An .xlsx file saved from the template.");
  const fileIn = el("input", "input");
  fileIn.type = "file"; fileIn.accept = ".xlsx";
  fileIn.setAttribute("aria-label", "Filled Excel file");
  c2.append(fileIn);

  /* Step 3: images */
  const c3 = card("3. Choose the images (optional)",
    "Only needed if you typed image file names in the Excel file. Select all the image files together (JPG, PNG or WebP); they are matched by file name.");
  const imgIn = el("input", "input");
  imgIn.type = "file"; imgIn.accept = IU.ACCEPT; imgIn.multiple = true;
  imgIn.setAttribute("aria-label", "Image files");
  const imgInfo = el("p", "field-hint");
  c3.append(imgIn, imgInfo);

  /* Step 4: check */
  const c4 = card("4. Check the file", "The file is checked row by row. Nothing is saved yet.");
  const checkBtn = button("Check file", "btn-primary", () => doCheck());
  checkBtn.disabled = true;
  c4.append(checkBtn);

  const out = el("div", "bu-out");
  wrap.append(out);

  const backRow = el("div", "a-actions");
  backRow.append(button("Back to questions", "btn-outline", () => { release(); o.onClose(!!(st.outcome && st.outcome.saved)); }));
  wrap.append(backRow);

  function sync() {
    checkBtn.disabled = st.busy || !st.file;
    tplBtn.disabled = st.busy;
    fileIn.disabled = st.busy; imgIn.disabled = st.busy;
  }
  fileIn.addEventListener("change", () => {
    st.file = fileIn.files && fileIn.files[0] ? fileIn.files[0] : null;
    st.result = null; st.outcome = null;
    if (st.file && !/\.xlsx$/i.test(st.file.name)) { st.file = null; fileIn.value = ""; api.notice("Please choose an .xlsx file.", true); }
    else api.notice("");
    out.textContent = "";
    sync();
  });
  imgIn.addEventListener("change", () => {
    st.images = Array.prototype.slice.call(imgIn.files || []);
    imgInfo.textContent = st.images.length ? plural(st.images.length, "image chosen.", "images chosen.") : "";
    st.result = null; st.outcome = null;
    out.textContent = "";
    sync();
  });

  async function doCheck() {
    st.busy = true; st.result = null; st.outcome = null; st.includeDups = false;
    sync();
    out.textContent = "";
    out.append(el("div", "a-empty", "Checking the file\u2026"));
    api.notice("");
    try {
      st.result = await checkFile(st.file, st.images);
    } catch (err) {
      console.error(err);
      st.result = null;
      out.textContent = "";
      api.notice("The file could not be checked. " + (err && err.message && /spreadsheet/.test(err.message) ? err.message : api.failText(err)), true);
    }
    st.busy = false;
    sync();
    if (st.result) renderResult();
  }

  /* ── Report ── */
  const rowsOf = (e) => (e.rows.length > 1 ? e.rows[0] + "\u2013" + e.rows[e.rows.length - 1] : String(e.rows[0]));
  const stemShort = (e) => {
    const f = e.fields || {};
    const t = (f.type === "assertion_reason" ? "A: " + (f.assertionLatex || "") + "  R: " + (f.reasonLatex || "") : (f.questionLatex || "")).replace(/\s+/g, " ").trim();
    return t.length > 160 ? t.slice(0, 160) + "\u2026" : t;
  };
  const tag = (text) => el("span", "q-tag", text);

  function block(title, entries, kind, limit) {
    const box = el("section", "bu-card");
    box.append(el("h3", null, title));
    const list = el("div", "a-list");
    entries.slice(0, limit).forEach((e) => {
      const row = el("div", "bu-item");
      row.append(el("div", "a-name", e.sheet + ", row" + (e.rows.length > 1 ? "s " : " ") + rowsOf(e)));
      if (kind === "error") (e.errs.length ? e.errs : ["Unknown problem."]).forEach((m) => row.append(el("div", "bu-msg is-error", m)));
      else row.append(el("div", "bu-msg", e.dupNote));
      const s = stemShort(e);
      if (s) row.append(el("div", "bu-stem", s));
      list.append(row);
    });
    box.append(list);
    if (entries.length > limit) box.append(el("p", "field-hint", "Showing the first " + limit + " of " + entries.length + ". Download the report for the full list."));
    return box;
  }

  function renderResult() {
    const R = st.result;
    out.textContent = "";
    if (R.fileErrors.length) {
      const eb = el("div", "portal-error"); eb.setAttribute("role", "alert");
      R.fileErrors.forEach((m) => eb.append(el("div", null, m)));
      out.append(eb);
    }
    if (!R.entries.length) {
      if (!R.fileErrors.length) out.append(el("div", "a-empty", "No questions were found below the blue line in the sheets."));
      return;
    }
    const ready = R.entries.filter((e) => e.state === "ready");
    const dups = R.entries.filter((e) => e.state === "duplicate");
    const bad = R.entries.filter((e) => e.state === "error");

    const sum = el("section", "bu-card");
    sum.append(el("h3", null, "Check result"));
    const chips = el("div", "q-qtop");
    chips.append(tag(plural(ready.length, "question ready to import", "questions ready to import")),
      tag(plural(dups.length, "possible duplicate", "possible duplicates")),
      tag(plural(bad.length, "row group with problems", "row groups with problems")));
    sum.append(chips);
    sum.append(el("p", "field-hint", "Rows with problems are not imported. Possible duplicates are skipped unless you tick the box below. Everything else is saved with the Status you typed (Draft when empty)."));
    out.append(sum);

    if (bad.length) out.append(block("Problems (not imported)", bad, "error", 200));
    if (dups.length) out.append(block("Possible duplicates (skipped by default)", dups, "dup", 100));

    if (ready.length) {
      const pv = el("section", "bu-card");
      pv.append(el("h3", null, "Ready to import"));
      const list = el("div", "a-list");
      ready.slice(0, 100).forEach((e) => {
        const row = el("div", "bu-item");
        const top = el("div", "q-qtop");
        top.append(tag(e.board + " \u00b7 Class " + e.cls + " \u00b7 " + e.subject), tag("Ch " + e.chapterNumber), tag(Q.typeLabel(e.fields.type)),
          tag(e.fields.difficulty), tag(e.fields.marks + (e.fields.marks === 1 ? " mark" : " marks")),
          tag(e.fields.status === "published" ? "Published" : "Draft"));
        if (e.fields.grouping) top.append(tag("Group: " + e.fields.grouping));
        if (e.qImg || e.eImg) top.append(tag("Image"));
        row.append(top);
        const s = stemShort(e);
        if (s) row.append(el("div", "bu-stem", s));
        e.warns.forEach((m) => row.append(el("div", "bu-msg", m)));
        list.append(row);
      });
      pv.append(list);
      if (ready.length > 100) pv.append(el("p", "field-hint", "Showing the first 100 of " + ready.length + "."));
      out.append(pv);
    }

    const act = el("section", "bu-card");
    let dupBox = null;
    if (dups.length) {
      const lab = el("label", "choice");
      dupBox = el("input"); dupBox.type = "checkbox";
      lab.append(dupBox, el("span", null, "Also import the " + plural(dups.length, "possible duplicate", "possible duplicates")));
      dupBox.addEventListener("change", () => { st.includeDups = dupBox.checked; updateImportBtn(); });
      act.append(lab);
    }
    const acts = el("div", "a-actions");
    const importBtn = button("Import", "btn-primary", () => doImport());
    const rep = (bad.length || dups.length) ? button("Download problem report", "btn-outline", async (b) => {
      b.disabled = true;
      try {
        const ExcelJS = await loadExcel();
        const rows = bad.map((e) => ({ sheet: e.sheet, rows: e.rows, kind: "Problem (not imported)", text: e.errs.join(" ") }))
          .concat(dups.map((e) => ({ sheet: e.sheet, rows: e.rows, kind: "Possible duplicate", text: e.dupNote })));
        saveBlob(new Blob([await B.buildReport(ExcelJS, rows).xlsx.writeBuffer()], { type: XLSX_MIME }), "upload-problem-report.xlsx");
      } catch (err) { console.error(err); api.notice("The report could not be prepared. Please try again.", true); }
      b.disabled = false;
    }) : null;
    function updateImportBtn() {
      const n = ready.length + (st.includeDups ? dups.length : 0);
      importBtn.textContent = n ? "Import " + plural(n, "question", "questions") : "Nothing to import";
      importBtn.disabled = st.busy || !n;
    }
    updateImportBtn();
    acts.append(importBtn);
    if (rep) acts.append(rep);
    act.append(acts);
    const prog = el("p", "field-hint bu-prog"); prog.setAttribute("role", "status");
    act.append(prog);
    out.append(act);
    st._ui = { importBtn: importBtn, prog: prog, ready: ready, dups: dups, update: updateImportBtn };
  }

  async function doImport() {
    const U = st._ui;
    const list = U.ready.concat(st.includeDups ? U.dups : []);
    if (!list.length) return;
    const ok = await api.confirmDialog({
      title: "Import " + plural(list.length, "question", "questions") + "?",
      text: "They will be saved to their chapters with the Status typed in the file (Draft when empty). Images are uploaded as part of the import. Keep this page open until it finishes.",
      ok: "Import"
    });
    if (!ok) return;
    st.busy = true; sync(); U.importBtn.disabled = true;
    api.notice("");
    const imageMap = new Map();
    st.images.forEach((f) => imageMap.set(f.name.toLowerCase(), f));
    let result;
    try {
      result = await runImport(list, imageMap, api.adminEmail(), (d, t, text) => { U.prog.textContent = text + " (" + d + " of " + t + ")"; });
    } catch (err) {
      console.error(err);
      result = { saved: 0, failed: list.map((e) => ({ e: e, reason: "Unexpected error. This question was not saved." })), stopped: true, strayImages: 0 };
    }
    st.busy = false; st.outcome = result; sync();
    showOutcome(result, list.length);
  }

  function showOutcome(r, total) {
    out.textContent = "";
    const box = el("section", "bu-card");
    box.append(el("h3", null, r.failed.length ? "Import finished with problems" : "Import finished"));
    box.append(el("p", null, plural(r.saved, "question was", "questions were") + " saved" + (r.failed.length ? "; " + plural(r.failed.length, "was", "were") + " not saved." : ".")));
    if (r.strayImages) box.append(el("p", "bu-msg is-error", plural(r.strayImages, "uploaded image", "uploaded images") + " could not be removed from ImageKit after a failed step; delete them from the ImageKit media library."));
    if (r.failed.length) {
      const list = el("div", "a-list");
      r.failed.slice(0, 200).forEach((f) => {
        const row = el("div", "bu-item");
        row.append(el("div", "a-name", f.e.sheet + ", row" + (f.e.rows.length > 1 ? "s " : " ") + rowsOf(f.e)));
        row.append(el("div", "bu-msg is-error", f.reason));
        list.append(row);
      });
      box.append(list);
      box.append(el("p", "field-hint", "Fix these rows in your file and upload them again. Questions that were saved are not repeated if you choose to skip duplicates when you check the file again."));
    }
    out.append(box);
    api.notice(plural(r.saved, "question", "questions") + " imported" + (r.failed.length ? "; " + r.failed.length + " not saved. See the list below." : "."), !!r.failed.length);
    window.scrollTo(0, 0);
  }

  sync();
}
