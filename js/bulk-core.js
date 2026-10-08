/* ─────────────────────────────────────────────────────────────────────
 * bulk-core.js  (ES module, Phase 5 bulk upload: the spreadsheet side)
 * Builds the downloadable Excel template, reads a filled file and checks
 * every row with the same rules as the question editor. No Firebase and no
 * page code here: the Excel library and the question settings are passed in,
 * so everything in this file is plain data in, plain data out.
 *
 * Template layout (one sheet per question family, see SHEETS below):
 *   row 1            column headings
 *   example rows     shaded, above the marker line, never imported
 *   marker row       the line "ENTER QUESTIONS BELOW THIS ROW" in column A
 *   rows below it    the questions that are imported
 * ───────────────────────────────────────────────────────────────────── */

export const MARKER = "ENTER QUESTIONS BELOW THIS ROW";
export const MAX_QUESTIONS = 500;
export const GROUPING_MAX = 60;

const OPT = ["Option A", "Option B", "Option C", "Option D", "Option E", "Option F"];
const LEFT = ["Left 1", "Left 2", "Left 3", "Left 4", "Left 5", "Left 6", "Left 7", "Left 8"];
const RIGHT = ["Right A", "Right B", "Right C", "Right D", "Right E", "Right F", "Right G", "Right H"];
const IMG = ["Question Image File", "Explanation Image File"];

const OBJECTIVE_TYPES = ["mcq_single", "mcq_multi", "true_false", "fill_blank", "numerical", "assertion_reason"];
const WRITTEN_TYPES = ["very_short", "short", "long"];

/* Sheet definitions. "required" are the headings the file must contain. */
export const SHEETS = {
  objective: {
    name: "Objective", dataRows: 600,
    cols: ["Board", "Class", "Subject", "Chapter No", "Type", "Difficulty", "Marks", "Status", "Grouping",
      "Question", "Assertion (A)", "Reason (R)"].concat(OPT, ["Correct Answer", "Tolerance", "Explanation"], IMG),
    required: ["Board", "Class", "Subject", "Chapter No", "Type", "Difficulty", "Marks", "Question", "Correct Answer"]
  },
  match: {
    name: "Match", dataRows: 600,
    cols: ["Board", "Class", "Subject", "Chapter No", "Difficulty", "Marks", "Status", "Grouping", "Question"]
      .concat(LEFT, RIGHT, ["Matches", "Explanation"], IMG),
    required: ["Board", "Class", "Subject", "Chapter No", "Difficulty", "Marks", "Question", "Left 1", "Left 2", "Right A", "Right B", "Matches"]
  },
  case: {
    name: "Case-based", dataRows: 1500,
    cols: ["Board", "Class", "Subject", "Chapter No", "Case ID", "Difficulty", "Status", "Grouping", "Passage", "Explanation"]
      .concat(IMG, ["Sub Type", "Sub Marks", "Sub Question"], OPT, ["Correct Answer", "Tolerance", "Model Answer"]),
    required: ["Board", "Class", "Subject", "Chapter No", "Case ID", "Difficulty", "Passage", "Sub Type", "Sub Marks", "Sub Question"]
  },
  written: {
    name: "Written", dataRows: 600,
    cols: ["Board", "Class", "Subject", "Chapter No", "Type", "Difficulty", "Marks", "Status", "Grouping",
      "Question", "Model Answer", "Explanation"].concat(IMG),
    required: ["Board", "Class", "Subject", "Chapter No", "Type", "Difficulty", "Marks", "Question", "Model Answer"]
  }
};

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();

/* ── Cell values: ExcelJS can hand back text, numbers, rich text, formulas ── */
export function cellText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((p) => p.text || "").join("").trim();
    if ("result" in v) return cellText(v.result);
    if (typeof v.text === "string") return v.text.trim();
    if (v.text && typeof v.text === "object") return cellText(v.text);
    if (typeof v.error === "string") return "";
  }
  return "";
}

/* ───────────────────────── Template ───────────────────────── */

const FILL_HEAD = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF0F3" } };
const FILL_EXAMPLE = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7F7" } };
const FILL_MARKER = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6FF" } };

function instructionLines(cfg) {
  return [
    ["Bulk upload template", "title"],
    ["Fill in the sheets you need, save the file as .xlsx, and upload it in ProfAdmin: Questions, Bulk upload. Leave unused sheets empty.", ""],
    ["", ""],
    ["The basics", "head"],
    ["Type your questions in the rows BELOW the blue line that says \"" + MARKER + "\". The shaded rows above the line are examples and are never imported.", ""],
    ["Do not rename the sheets, do not rename or move the column headings in row 1, and do not delete the blue line.", ""],
    ["One upload can hold up to " + MAX_QUESTIONS + " questions. Split bigger files into several uploads.", ""],
    ["Nothing is saved until you have seen the check report and confirmed the import.", ""],
    ["", ""],
    ["Columns common to every sheet", "head"],
    ["Board, Class, Subject: pick from the dropdowns. Only the real combinations work: CBSE Class 10 Science, CBSE Class 12 Physics or Chemistry, State Board Class 12 Physics or Chemistry.", ""],
    ["Chapter No: the chapter number you gave the chapter in ProfAdmin. The chapter must already exist; see the \"Chapters\" sheet for the chapters that existed when you downloaded this template. If two chapters of a subject share a number, the row cannot be matched and is reported as a problem.", ""],
    ["Difficulty: Easy, Medium or Hard.", ""],
    ["Marks: a positive number in steps of 0.5, up to 100 (case-based questions take the total of their sub-question marks instead).", ""],
    ["Status: Draft or Published. Leave it empty for Draft. A Published question must not have LaTeX errors.", ""],
    ["Grouping (optional): a word, phrase or number of your choice. Questions in the same chapter that carry the same Grouping are variations of each other, and an auto-generated paper will take at most one question from a group. Groups never cross chapters. Up to " + GROUPING_MAX + " characters.", ""],
    ["Explanation (optional): shown to students with the answer.", ""],
    ["Question, Passage, options, explanations and model answers are written in LaTeX, exactly as in the question editor, for example \\( v = u + at \\) and \\( \\ce{H2O} \\).", ""],
    ["", ""],
    ["Sheet: Objective", "head"],
    ["Type: " + OBJECTIVE_TYPES.map((t) => cfg.typeLabel(t)).join("; ") + ".", ""],
    ["Option A to Option F: fill them in order from Option A, with no gaps. MCQ needs 2 to 6 options.", ""],
    ["Correct Answer: MCQ (single correct): one letter, for example B. MCQ (multiple correct): letters separated by commas, for example A,C. True / False: True or False. Fill in the blank: every accepted answer, separated by | for example 4|four. Numerical: the number. Assertion and Reason: one letter from A to D.", ""],
    ["Tolerance: Numerical only, optional. Answers within this distance of the correct value count as correct; empty or 0 means exact.", ""],
    ["Assertion (A) and Reason (R): Assertion and Reason only; leave Question empty. Leave the options empty to use the four standard options, or type all four of your own.", ""],
    ["", ""],
    ["Sheet: Match", "head"],
    ["Left 1 to Left 8 are the items of Column I; Right A to Right H are the items of Column II. Fill each side in order, at least two items.", ""],
    ["Matches: the right-hand letter for each left item, in order, separated by commas. Example: B,A,D,C means Left 1 matches Right B, Left 2 matches Right A, and so on.", ""],
    ["", ""],
    ["Sheet: Case-based", "head"],
    ["A case has one row per sub-question (1 to 6). Rows that belong to the same case carry the same Case ID (any text, for example C1).", ""],
    ["Board, Class, Subject, Chapter No, Difficulty, Status, Grouping, Passage, Explanation and the image columns are read from the first row of the case; later rows of the case may leave them empty.", ""],
    ["Sub Type: " + cfg.SUB_TYPES.map((t) => cfg.typeLabel(t)).join("; ") + ".", ""],
    ["Sub Question, the options, Correct Answer and Tolerance follow the same rules as the Objective sheet. Very short and short sub-questions use Model Answer instead of a Correct Answer.", ""],
    ["", ""],
    ["Sheet: Written", "head"],
    ["Type: " + WRITTEN_TYPES.map((t) => cfg.typeLabel(t)).join("; ") + ". Model Answer is required; students compare their own answer with it.", ""],
    ["", ""],
    ["Images (optional)", "head"],
    ["Type an image's file name in Question Image File or Explanation Image File, for example pulley.png, and choose the image files in the upload screen together with this Excel file. Files are matched by name (capital letters do not matter). Leave the cell empty for no image.", ""],
    ["JPG, PNG or WebP only. Images over 2 MB are shrunk automatically. Case-based sub-questions, options and Match items cannot have images.", ""],
    ["If a file name is typed but that image is not chosen in the upload screen, the row is reported as a problem and not imported.", ""],
    ["", ""],
    ["Checks before saving", "head"],
    ["Every row is checked for a missing or unknown chapter, missing answers, invalid values and LaTeX problems. Rows with problems are listed and not imported; you can download that list.", ""],
    ["A question whose text is identical to one already in the same chapter, or to an earlier row of this file, is flagged as a possible duplicate and skipped unless you choose to import it. Variations that are worded differently are not duplicates; use Grouping for those.", ""]
  ];
}

function columnLetter(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function addList(ws, col, header, values) {
  ws.getCell(1, col).value = header;
  values.forEach((v, i) => { ws.getCell(i + 2, col).value = v; });
  const L = String.fromCharCode(64 + col);
  return "Lists!$" + L + "$2:$" + L + "$" + (values.length + 1);
}

/* chaptersByFolder: [{ board, cls, subject, chapters: [{ chapterNumber, chapterName, edition }] }] */
export function buildTemplate(ExcelJS, cfg, chaptersByFolder) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Prof. Dr. S. Balaji Science Academy";

  /* Instructions */
  const ins = wb.addWorksheet("Instructions", { properties: { tabColor: { argb: "FF0052FF" } } });
  ins.getColumn(1).width = 120;
  instructionLines(cfg).forEach((ln, i) => {
    const c = ins.getCell(i + 1, 1);
    c.value = ln[0];
    c.alignment = { wrapText: true, vertical: "top" };
    if (ln[1] === "title") c.font = { bold: true, size: 16 };
    if (ln[1] === "head") c.font = { bold: true, size: 12 };
  });

  /* Hidden dropdown lists */
  const lists = wb.addWorksheet("Lists", { state: "hidden" });
  const boards = [], classes = [], subjects = [];
  cfg.FOLDERS.forEach((f) => {
    if (boards.indexOf(f.board) === -1) boards.push(f.board);
    if (classes.indexOf(f.cls) === -1) classes.push(f.cls);
    f.subjects.forEach((s) => { if (subjects.indexOf(s) === -1) subjects.push(s); });
  });
  const LIST = {
    board: addList(lists, 1, "Board", boards),
    cls: addList(lists, 2, "Class", classes),
    subject: addList(lists, 3, "Subject", subjects),
    difficulty: addList(lists, 4, "Difficulty", cfg.DIFFICULTIES),
    status: addList(lists, 5, "Status", ["Draft", "Published"]),
    objType: addList(lists, 6, "Objective types", OBJECTIVE_TYPES.map((t) => cfg.typeLabel(t))),
    writtenType: addList(lists, 7, "Written types", WRITTEN_TYPES.map((t) => cfg.typeLabel(t))),
    subType: addList(lists, 8, "Sub-question types", cfg.SUB_TYPES.map((t) => cfg.typeLabel(t)))
  };

  const dvFor = {
    objective: { "Board": LIST.board, "Class": LIST.cls, "Subject": LIST.subject, "Type": LIST.objType, "Difficulty": LIST.difficulty, "Status": LIST.status },
    match: { "Board": LIST.board, "Class": LIST.cls, "Subject": LIST.subject, "Difficulty": LIST.difficulty, "Status": LIST.status },
    case: { "Board": LIST.board, "Class": LIST.cls, "Subject": LIST.subject, "Difficulty": LIST.difficulty, "Status": LIST.status, "Sub Type": LIST.subType },
    written: { "Board": LIST.board, "Class": LIST.cls, "Subject": LIST.subject, "Type": LIST.writtenType, "Difficulty": LIST.difficulty, "Status": LIST.status }
  };

  const T = (id) => cfg.typeLabel(id);
  const base = { "Board": "CBSE", "Class": 12, "Subject": "Physics", "Chapter No": 1, "Difficulty": "Medium", "Status": "Draft" };
  const examples = {
    objective: [
      { ...base, "Type": T("mcq_single"), "Marks": 1, "Grouping": "newton-2nd-law",
        "Question": "The SI unit of force is", "Option A": "joule", "Option B": "newton", "Option C": "watt", "Option D": "pascal",
        "Correct Answer": "B", "Explanation": "Force is measured in \\( \\mathrm{kg\\,m\\,s^{-2}} \\), called the newton." },
      { ...base, "Type": T("numerical"), "Marks": 2, "Question": "Find \\( v \\) in m/s when \\( u = 2 \\), \\( a = 3 \\) and \\( t = 4 \\) (all SI units).",
        "Correct Answer": 14, "Tolerance": 0 }
    ],
    match: [
      { ...base, "Marks": 2, "Question": "Match the quantity with its unit.",
        "Left 1": "Force", "Left 2": "Work", "Right A": "joule", "Right B": "newton", "Matches": "B,A" }
    ],
    case: [
      { ...base, "Case ID": "C1", "Passage": "A block of mass 2 kg is pulled by a force of 10 N on a smooth surface.", "Sub Type": T("numerical"),
        "Sub Marks": 1, "Sub Question": "Find the acceleration in m/s\\(^2\\).", "Correct Answer": 5 },
      { "Case ID": "C1", "Sub Type": T("mcq_single"), "Sub Marks": 1, "Sub Question": "The surface is smooth, so friction is",
        "Option A": "zero", "Option B": "large", "Correct Answer": "A" }
    ],
    written: [
      { ...base, "Type": T("short"), "Marks": 2, "Question": "State Newton's second law of motion.",
        "Model Answer": "The rate of change of momentum of a body is directly proportional to the applied force." }
    ]
  };

  Object.keys(SHEETS).forEach((key) => {
    const spec = SHEETS[key];
    const ws = wb.addWorksheet(spec.name);
    ws.views = [{ state: "frozen", ySplit: 1 }];
    spec.cols.forEach((h, i) => {
      const c = ws.getCell(1, i + 1);
      c.value = h;
      c.font = { bold: true };
      c.fill = FILL_HEAD;
      c.alignment = { vertical: "middle", wrapText: true };
      const wide = /^(Question|Passage|Sub Question|Model Answer|Explanation|Assertion|Reason)/.test(h);
      ws.getColumn(i + 1).width = wide ? 48 : /^(Option|Left|Right)/.test(h) ? 24 : /Image File/.test(h) ? 24 : 14;
    });
    const ex = examples[key];
    ex.forEach((row, r) => {
      spec.cols.forEach((h, i) => {
        const c = ws.getCell(r + 2, i + 1);
        if (row[h] !== undefined) c.value = row[h];
        c.font = { italic: true, color: { argb: "FF7C828A" } };
        c.fill = FILL_EXAMPLE;
        c.alignment = { wrapText: true, vertical: "top" };
      });
    });
    const markerRow = ex.length + 3;
    for (let i = 1; i <= spec.cols.length; i++) ws.getCell(markerRow, i).fill = FILL_MARKER;
    const mc = ws.getCell(markerRow, 1);
    mc.value = MARKER;
    mc.font = { bold: true, color: { argb: "FF0052FF" } };
    Object.keys(dvFor[key]).forEach((h) => {
      const col = spec.cols.indexOf(h) + 1;
      if (!col) return;
      const L = columnLetter(col);
      ws.dataValidations.add(L + (markerRow + 1) + ":" + L + (markerRow + spec.dataRows), {
        type: "list", allowBlank: true, formulae: [dvFor[key][h]],
        showErrorMessage: true, errorStyle: "warning", errorTitle: h, error: "Please choose a value from the list."
      });
    });
  });

  /* Chapters reference (not read on upload) */
  const chs = wb.addWorksheet("Chapters");
  ["Board", "Class", "Subject", "Chapter No", "Chapter Name", "Edition"].forEach((h, i) => {
    const c = chs.getCell(1, i + 1);
    c.value = h; c.font = { bold: true }; c.fill = FILL_HEAD;
  });
  [14, 10, 14, 12, 50, 20].forEach((w, i) => { chs.getColumn(i + 1).width = w; });
  let r = 2;
  (chaptersByFolder || []).forEach((f) => {
    (f.chapters || []).forEach((c) => {
      [f.board, Number(f.cls), f.subject, c.chapterNumber, c.chapterName, c.edition || ""].forEach((v, i) => { chs.getCell(r, i + 1).value = v; });
      r += 1;
    });
  });
  if (r === 2) chs.getCell(2, 1).value = "No chapters existed when this template was downloaded. Create them in ProfAdmin first.";

  return wb;
}

/* ───────────────────────── Reading and checking ───────────────────────── */

function readSheet(ws, spec, fileErrors) {
  const header = {};
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => { header[norm(cellText(cell.value))] = col; });
  const missing = spec.required.filter((h) => !header[norm(h)]);
  if (missing.length) {
    fileErrors.push("Sheet \"" + spec.name + "\" does not match the template (missing heading: " + missing.join(", ") + "). Please download a fresh template.");
    return null;
  }
  let marker = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 80); r++) {
    if (cellText(ws.getRow(r).getCell(1).value) === MARKER) { marker = r; break; }
  }
  if (!marker) {
    fileErrors.push("Sheet \"" + spec.name + "\": the blue line \"" + MARKER + "\" was not found. Please use the downloaded template and keep that line.");
    return null;
  }
  const rows = [];
  for (let r = marker + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const v = {};
    let any = false;
    spec.cols.forEach((h) => {
      const c = header[norm(h)];
      const t = c ? cellText(row.getCell(c).value) : "";
      v[h] = t;
      if (t !== "") any = true;
    });
    if (any) rows.push({ rowNo: r, v: v });
  }
  return rows;
}

const BOARDS = { "cbse": "CBSE", "state board": "State Board" };
const SUBJECTS = { "physics": "Physics", "chemistry": "Chemistry", "science": "Science" };

function parseMarks(t) {
  const n = parseFloat(t);
  if (t === "" || !isFinite(n) || n <= 0 || n > 100 || (n * 2) % 1 !== 0) return NaN;
  return n;
}

/* Board, class, subject, chapter number, difficulty, status, grouping. */
function readCommon(v, errs) {
  const out = {};
  out.board = BOARDS[norm(v["Board"])];
  if (!out.board) errs.push("Board must be CBSE or State Board.");
  const cls = String(v["Class"]).replace(/\.0+$/, "").trim();
  out.cls = (cls === "10" || cls === "12") ? cls : "";
  if (!out.cls) errs.push("Class must be 10 or 12.");
  out.subject = SUBJECTS[norm(v["Subject"])];
  if (!out.subject) errs.push("Subject must be Physics, Chemistry or Science.");
  const chn = String(v["Chapter No"]).replace(/\.0+$/, "").trim();
  out.chapterNumber = /^\d{1,2}$/.test(chn) && +chn >= 1 ? +chn : 0;
  if (!out.chapterNumber) errs.push("Chapter No must be a whole number from 1 to 99.");
  const d = ["easy", "medium", "hard"].indexOf(norm(v["Difficulty"]));
  out.difficulty = d === -1 ? "" : ["Easy", "Medium", "Hard"][d];
  if (!out.difficulty) errs.push("Difficulty must be Easy, Medium or Hard.");
  const st = norm(v["Status"]);
  if (st === "" || st === "draft") out.status = "draft";
  else if (st === "published") out.status = "published";
  else { out.status = "draft"; errs.push("Status must be Draft or Published (or empty for Draft)."); }
  const g = String(v["Grouping"] || "").replace(/\s+/g, " ").trim();
  if (g.length > GROUPING_MAX) errs.push("Grouping is too long (" + g.length + " characters; the limit is " + GROUPING_MAX + ").");
  out.grouping = g.length > GROUPING_MAX ? "" : g;
  return out;
}

/* "A", "a,c", "B; D" → indexes. bad is true when something does not fit. */
function letterList(text, n) {
  const parts = String(text).split(/[\s,;/&]+/).filter(Boolean).map((x) => x.toUpperCase());
  const idx = [];
  let bad = !parts.length;
  parts.forEach((x) => {
    const i = x.length === 1 ? x.charCodeAt(0) - 65 : -1;
    if (i < 0 || i >= n) bad = true;
    else if (idx.indexOf(i) === -1) idx.push(i);
  });
  return { idx: idx.sort((a, b) => a - b), bad: bad };
}

function readOptions(v, E) {
  const vals = OPT.map((h) => v[h] || "");
  let last = -1;
  vals.forEach((t, i) => { if (t) last = i; });
  const opts = vals.slice(0, last + 1);
  if (opts.some((t) => !t)) E("Options must be filled in order from Option A, with no empty option between two filled ones.");
  return opts;
}

/* The answer part of one question (also used for sub-questions). */
function parseAnswer(cfg, type, v, E) {
  const q = {}, k = {};
  const correct = v["Correct Answer"] || "";
  if (type === "mcq_single" || type === "mcq_multi") {
    const opts = readOptions(v, E);
    if (opts.length < 2) E("Fill in at least Option A and Option B.");
    q.options = opts;
    if (!correct) E("Correct Answer is required.");
    else {
      const r = letterList(correct, Math.max(opts.length, 1));
      if (r.bad) E("Correct Answer \"" + correct + "\" does not match the options.");
      else if (type === "mcq_single" && r.idx.length !== 1) E("A single-answer MCQ needs exactly one correct option.");
      else k.correct = r.idx;
    }
  } else if (type === "true_false") {
    const t = norm(correct);
    if (t === "true" || t === "t") k.correct = [0];
    else if (t === "false" || t === "f") k.correct = [1];
    else E("Correct Answer must be True or False.");
  } else if (type === "fill_blank") {
    const seen = {}, list = [];
    correct.split("|").forEach((p) => { const t = p.trim(); if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = 1; list.push(t); } });
    if (!list.length) E("Correct Answer needs at least one accepted answer (separate several with |).");
    else if (list.length > 8) E("At most 8 accepted answers are allowed.");
    else if (list.some((t) => t.length > 200)) E("An accepted answer is longer than 200 characters.");
    else k.acceptedAnswers = list;
  } else if (type === "numerical") {
    const n = correct === "" ? NaN : Number(correct);
    const tolText = v["Tolerance"] || "";
    const tol = tolText === "" ? 0 : Number(tolText);
    if (!isFinite(n)) E("Correct Answer must be a number.");
    if (!isFinite(tol) || tol < 0) E("Tolerance must be 0 or more.");
    if (isFinite(n) && isFinite(tol) && tol >= 0) { k.numericAnswer = n; k.tolerance = tol; }
  } else {
    const m = v["Model Answer"] || "";
    if (!m) E("Model Answer is required.");
    else k.modelAnswerLatex = m;
  }
  return { q: q, k: k };
}

const stemOf = (f) => f.type === "assertion_reason"
  ? (f.assertionLatex || "") + " || " + (f.reasonLatex || "")
  : (f.questionLatex || "");

/* The text two questions are compared by when looking for duplicates. */
export function stemKey(q) {
  return stemOf(q).replace(/\s+/g, " ").trim().toLowerCase();
}

function latexStrings(f, k) {
  const out = [f.questionLatex, f.assertionLatex, f.reasonLatex].concat(f.options || [], f.matchLeft || [], f.matchRight || [],
    [k.explanationLatex, k.modelAnswerLatex]);
  (f.subQuestions || []).forEach((s) => { out.push(s.questionLatex); (s.options || []).forEach((o) => out.push(o)); });
  (k.subKeys || []).forEach((s) => out.push(s.modelAnswerLatex));
  return out.filter((x) => typeof x === "string" && x);
}

function typeIndex(cfg) {
  const map = {};
  cfg.TYPES.forEach((t) => { map[norm(t.id)] = t.id; map[norm(t.label)] = t.id; });
  return map;
}

function newEntry(sheet, rowNos, label) {
  return { sheet: sheet, rows: rowNos, label: label, errs: [], warns: [], state: "ready",
    fields: {}, keys: {}, qImg: "", eImg: "", chapter: null, dupNote: "" };
}

function finishEntry(cfg, e, common) {
  if (common) {
    e.board = common.board; e.cls = common.cls; e.subject = common.subject;
    e.chapterNumber = common.chapterNumber; e.status = common.status;
    e.fields.difficulty = common.difficulty;
    e.fields.status = common.status;
    if (common.grouping) e.fields.grouping = common.grouping;
    if (common.board && common.cls && common.subject && !cfg.levelsFor(common.board, common.cls, common.subject).length) {
      e.errs.push("This board, class and subject combination does not exist in the question bank.");
    }
  }
  /* LaTeX problems block a published question; a draft keeps them as a warning (as in the editor). */
  const issues = [];
  latexStrings(e.fields, e.keys).forEach((t) => {
    cfg.validateLatex(t).forEach((i) => { if (i.level === "error" && issues.indexOf(i.message) === -1) issues.push(i.message); });
  });
  if (issues.length) {
    const shown = issues.slice(0, 3).join(" ") + (issues.length > 3 ? " (and " + (issues.length - 3) + " more)" : "");
    if (e.status === "published") e.errs.push("LaTeX problem: " + shown + " A published question cannot have LaTeX errors; fix them or set Status to Draft.");
    else e.warns.push("LaTeX problem kept in the draft: " + shown);
  }
  e.stem = stemKey(e.fields);
  if (e.errs.length) e.state = "error";
  return e;
}

function buildObjective(cfg, item, types) {
  const v = item.v;
  const e = newEntry(SHEETS.objective.name, [item.rowNo], "Objective, row " + item.rowNo);
  const E = (m) => e.errs.push(m);
  const common = readCommon(v, e.errs);
  const type = types[norm(v["Type"])];
  if (!type || OBJECTIVE_TYPES.indexOf(type) === -1) E("Type must be one of: " + OBJECTIVE_TYPES.map((t) => cfg.typeLabel(t)).join("; ") + ".");
  const marks = parseMarks(v["Marks"]);
  if (isNaN(marks)) E("Marks must be a positive number in steps of 0.5 (up to 100).");
  e.fields.type = type || ""; e.fields.marks = isNaN(marks) ? 0 : marks;
  e.qImg = v["Question Image File"]; e.eImg = v["Explanation Image File"];
  e.keys.explanationLatex = v["Explanation"] || "";
  if (type === "assertion_reason") {
    e.fields.questionLatex = "";
    e.fields.assertionLatex = v["Assertion (A)"]; e.fields.reasonLatex = v["Reason (R)"];
    if (!e.fields.assertionLatex) E("Assertion (A) is required.");
    if (!e.fields.reasonLatex) E("Reason (R) is required.");
    const any = OPT.slice(0, 4).some((h) => v[h]) || v["Option E"] || v["Option F"];
    let opts = cfg.AR_OPTIONS.slice();
    if (any) {
      const own = readOptions(v, E);
      if (own.length !== 4) E("Give all four options (Option A to Option D) or leave all options empty to use the standard four.");
      else opts = own;
    }
    const r = parseAnswer(cfg, "mcq_single", { ...v, ...Object.fromEntries(opts.map((t, i) => [OPT[i], t])), "Option E": "", "Option F": "" }, E);
    e.fields.options = opts; Object.assign(e.keys, r.k);
  } else {
    e.fields.questionLatex = v["Question"];
    if (!e.fields.questionLatex) E("Question text is required.");
    if (type) {
      const r = parseAnswer(cfg, type, v, E);
      Object.assign(e.fields, r.q); Object.assign(e.keys, r.k);
    }
  }
  return finishEntry(cfg, e, common);
}

function buildMatch(cfg, item) {
  const v = item.v;
  const e = newEntry(SHEETS.match.name, [item.rowNo], "Match, row " + item.rowNo);
  const E = (m) => e.errs.push(m);
  const common = readCommon(v, e.errs);
  const marks = parseMarks(v["Marks"]);
  if (isNaN(marks)) E("Marks must be a positive number in steps of 0.5 (up to 100).");
  e.fields.type = "match"; e.fields.marks = isNaN(marks) ? 0 : marks;
  e.fields.questionLatex = v["Question"];
  if (!e.fields.questionLatex) E("Question text is required.");
  e.qImg = v["Question Image File"]; e.eImg = v["Explanation Image File"];
  e.keys.explanationLatex = v["Explanation"] || "";
  const side = (heads, label) => {
    const vals = heads.map((h) => v[h] || "");
    let last = -1;
    vals.forEach((t, i) => { if (t) last = i; });
    const list = vals.slice(0, last + 1);
    if (list.some((t) => !t)) E(label + " items must be filled in order with no gaps.");
    if (list.length < 2) E("Column " + label + " needs at least two items.");
    return list;
  };
  const left = side(LEFT, "I (Left)"), right = side(RIGHT, "II (Right)");
  e.fields.matchLeft = left; e.fields.matchRight = right;
  const m = v["Matches"];
  if (!m) E("Matches is required (for example B,A,D,C).");
  else {
    const parts = m.split(/[\s,;/&]+/).filter(Boolean).map((x) => x.toUpperCase());
    const map = parts.map((x) => (x.length === 1 ? x.charCodeAt(0) - 65 : -1));
    if (parts.length !== left.length) E("Matches lists " + parts.length + " letters but there are " + left.length + " left items.");
    else if (map.some((i) => i < 0 || i >= right.length)) E("Matches has a letter that is not one of the right-hand items.");
    else e.keys.matchMap = map;
  }
  return finishEntry(cfg, e, common);
}

function buildWritten(cfg, item, types) {
  const v = item.v;
  const e = newEntry(SHEETS.written.name, [item.rowNo], "Written, row " + item.rowNo);
  const E = (m) => e.errs.push(m);
  const common = readCommon(v, e.errs);
  const type = types[norm(v["Type"])];
  if (!type || WRITTEN_TYPES.indexOf(type) === -1) E("Type must be one of: " + WRITTEN_TYPES.map((t) => cfg.typeLabel(t)).join("; ") + ".");
  const marks = parseMarks(v["Marks"]);
  if (isNaN(marks)) E("Marks must be a positive number in steps of 0.5 (up to 100).");
  e.fields.type = type || ""; e.fields.marks = isNaN(marks) ? 0 : marks;
  e.fields.questionLatex = v["Question"];
  if (!e.fields.questionLatex) E("Question text is required.");
  const r = parseAnswer(cfg, "short", v, E);
  Object.assign(e.keys, r.k);
  e.qImg = v["Question Image File"]; e.eImg = v["Explanation Image File"];
  e.keys.explanationLatex = v["Explanation"] || "";
  return finishEntry(cfg, e, common);
}

function buildCase(cfg, caseId, items, types) {
  const first = items[0];
  const nos = items.map((i) => i.rowNo);
  const label = "Case-based, case " + caseId + ", row" + (nos.length > 1 ? "s " + nos[0] + " to " + nos[nos.length - 1] : " " + nos[0]);
  const e = newEntry(SHEETS.case.name, nos, label);
  const E = (m) => e.errs.push(m);
  const v = first.v;
  const common = readCommon(v, e.errs);
  /* Later rows of the case may not point at a different chapter. */
  items.slice(1).forEach((it) => {
    const w = it.v;
    const diff = ["Board", "Class", "Subject", "Chapter No"].some((h) => w[h] !== "" && norm(String(w[h]).replace(/\.0+$/, "")) !== norm(String(v[h]).replace(/\.0+$/, "")));
    if (diff) E("Row " + it.rowNo + " names a different board, class, subject or chapter than the first row of case " + caseId + ".");
  });
  e.fields.type = "case_based";
  e.fields.questionLatex = v["Passage"];
  if (!e.fields.questionLatex) E("The first row of the case needs the Passage.");
  e.qImg = v["Question Image File"]; e.eImg = v["Explanation Image File"];
  e.keys.explanationLatex = v["Explanation"] || "";
  if (items.length > 6) E("A case can have at most 6 sub-questions (this one has " + items.length + ").");
  const subs = [], subKeys = [];
  let sum = 0;
  items.slice(0, 6).forEach((it, i) => {
    const w = it.v;
    const pre = "Row " + it.rowNo + " (sub-question " + (i + 1) + "): ";
    const SE = (m) => e.errs.push(pre + m);
    const st = types[norm(w["Sub Type"])];
    if (!st || cfg.SUB_TYPES.indexOf(st) === -1) SE("Sub Type must be one of: " + cfg.SUB_TYPES.map((t) => cfg.typeLabel(t)).join("; ") + ".");
    const m = parseMarks(w["Sub Marks"]);
    if (isNaN(m)) SE("Sub Marks must be a positive number in steps of 0.5 (up to 100)."); else sum += m;
    if (!w["Sub Question"]) SE("Sub Question text is required.");
    const r = st ? parseAnswer(cfg, st, w, SE) : { q: {}, k: {} };
    subs.push({ type: st || "", marks: isNaN(m) ? 0 : m, questionLatex: w["Sub Question"], ...r.q });
    subKeys.push(r.k);
  });
  e.fields.subQuestions = subs; e.keys.subKeys = subKeys;
  e.fields.marks = sum;
  return finishEntry(cfg, e, common);
}

/* Reads an uploaded workbook. Returns { fileErrors, entries }.
 * Chapter matching, duplicate and image checks happen afterwards (bulk-upload.js),
 * because they need the database and the chosen image files. */
export async function readUpload(ExcelJS, cfg, arrayBuffer) {
  const fileErrors = [];
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(arrayBuffer); } catch (err) {
    return { fileErrors: ["This file could not be read. Please upload an .xlsx file saved from the template."], entries: [] };
  }
  const types = typeIndex(cfg);
  const entries = [];
  let sheetsFound = 0;
  Object.keys(SHEETS).forEach((key) => {
    const spec = SHEETS[key];
    const ws = wb.getWorksheet(spec.name);
    if (!ws) return;
    sheetsFound += 1;
    const rows = readSheet(ws, spec, fileErrors);
    if (!rows) return;
    if (key === "objective") rows.forEach((it) => entries.push(buildObjective(cfg, it, types)));
    else if (key === "match") rows.forEach((it) => entries.push(buildMatch(cfg, it)));
    else if (key === "written") rows.forEach((it) => entries.push(buildWritten(cfg, it, types)));
    else {
      const order = [], byId = {};
      rows.forEach((it) => {
        const id = it.v["Case ID"];
        if (!id) {
          const e = newEntry(spec.name, [it.rowNo], "Case-based, row " + it.rowNo);
          e.errs.push("Case ID is missing. Every sub-question row needs the Case ID of its case.");
          e.state = "error"; e.fields = { type: "case_based" };
          entries.push(e);
          return;
        }
        if (!byId[id]) { byId[id] = []; order.push(id); }
        byId[id].push(it);
      });
      order.forEach((id) => entries.push(buildCase(cfg, id, byId[id], types)));
    }
  });
  if (!sheetsFound) fileErrors.push("None of the template sheets (Objective, Match, Case-based, Written) were found. Please use the downloaded template.");
  if (entries.length > MAX_QUESTIONS) {
    fileErrors.push("This file has " + entries.length + " questions; one upload can hold at most " + MAX_QUESTIONS + ". Please split it into several files.");
  }
  return { fileErrors: fileErrors, entries: entries };
}

/* Error / duplicate report as a workbook. rows: [{ sheet, rows, label, kind, text, chapter }] */
export function buildReport(ExcelJS, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ["Sheet", "Row(s)", "Result", "Details"].forEach((h, i) => {
    const c = ws.getCell(1, i + 1);
    c.value = h; c.font = { bold: true }; c.fill = FILL_HEAD;
  });
  [16, 14, 22, 110].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  rows.forEach((r, i) => {
    const nums = r.rows;
    const rowText = nums.length > 1 ? nums[0] + " to " + nums[nums.length - 1] : String(nums[0]);
    [r.sheet, rowText, r.kind, r.text].forEach((v, c) => {
      const cell = ws.getCell(i + 2, c + 1);
      cell.value = v;
      cell.alignment = { wrapText: true, vertical: "top" };
    });
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return wb;
}
