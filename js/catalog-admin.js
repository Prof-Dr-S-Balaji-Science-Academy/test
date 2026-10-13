/* ─────────────────────────────────────────────────────────────────────
 * catalog-admin.js  (ES module, ProfAdmin "Catalog" section, Phase 10)
 * Create, rename and delete boards, classes and subjects, switch each
 * subject's access level on or off for sign-up. Everything here is cosmetic; the real lock is
 * Firestore Rules v10. All text is inserted with textContent.
 * ───────────────────────────────────────────────────────────────────── */
import * as Cat from "./catalog-core.js";

export function initCatalog(host, api) {
  const el = api.el;
  let busy = false;

  /* Runs one catalog change, shows the outcome and redraws. */
  async function act(fn, okText) {
    if (busy) return;
    busy = true;
    api.notice("");
    try {
      const r = await fn();
      if (r && r.ok === false) api.notice(r.message, true);
      else {
        if (okText) api.notice(okText);
        if (api.onChange) api.onChange();
      }
    } catch (err) {
      console.error(err);
      api.notice("Could not save. " + api.failText(err), true);
    }
    busy = false;
    render();
  }

  function btn(label, cls, fn) {
    const b = el("button", "btn btn-sm " + (cls || "btn-outline"), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  /* A name that turns into a text box when Rename is pressed. */
  function nameCell(text, sub, onSave) {
    const wrap = el("div", "cg-name");
    const show = () => {
      wrap.textContent = "";
      wrap.append(el("span", "cg-title", text));
      if (sub) wrap.append(el("span", "badge", sub));
    };
    show();
    wrap.edit = () => {
      wrap.textContent = "";
      const inp = el("input", "input cg-input");
      inp.type = "text"; inp.maxLength = 40; inp.value = text;
      inp.setAttribute("aria-label", "New name");
      const save = btn("Save", "btn-primary", () => onSave(inp.value));
      const cancel = btn("Cancel", "btn-outline", show);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") onSave(inp.value); if (e.key === "Escape") show(); });
      wrap.append(inp, save, cancel);
      inp.focus();
      inp.select();
    };
    return wrap;
  }

  /* A small inline form: fields = [{ label, max, upper, width }]. */
  function addForm(title, fields, buttonLabel, onSubmit) {
    const f = el("div", "cg-add");
    f.append(el("span", "cg-add-title", title));
    const inputs = fields.map((x) => {
      const inp = el("input", "input cg-input" + (x.width ? " " + x.width : ""));
      inp.type = "text"; inp.maxLength = x.max; inp.placeholder = x.label;
      inp.setAttribute("aria-label", x.label);
      if (x.upper) inp.addEventListener("input", () => { inp.value = inp.value.toUpperCase(); });
      f.append(inp);
      return inp;
    });
    const go = btn(buttonLabel, "btn-primary", () => onSubmit(inputs.map((i) => i.value)));
    f.append(go);
    inputs.forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); }));
    return f;
  }

  async function remove(label, fn, okText) {
    const ok = await api.confirmDialog({
      title: "Delete " + label + "?",
      text: "This removes it from the catalog. It can only be deleted while nothing depends on it.",
      ok: "Delete", danger: true
    });
    if (!ok) return;
    act(fn, okText);
  }

  /* ── One subject (with its access level) ── */
  function subjectRow(b, c, s) {
    const row = el("div", "cg-row cg-subject");
    const nm = nameCell(s.name, s.code, (v) => act(() => Cat.renameSubject(b.id, c.id, s.id, v), "Subject renamed."));
    const lv = Cat.levelsFor(b.id, c.id, s.id)[0];
    const open = lv ? Cat.levelActive(lv) : false;
    const state = el("span", "badge" + (open ? " is-approved" : ""), open ? "Open for sign-up" : "Hidden from sign-up");
    const acts = el("div", "cg-acts");
    if (lv) {
      acts.append(btn(open ? "Hide from sign-up" : "Show on sign-up", open ? "btn-outline" : "btn-primary",
        () => act(() => Cat.setLevelActive(lv, !open), open ? "Hidden from the sign-up form." : "Now open for sign-up.")));
    }
    acts.append(btn("Rename", "btn-outline", () => nm.edit()));
    acts.append(btn("Delete", "btn-danger", () => remove("the subject " + s.name, () => Cat.deleteSubject(b.id, c.id, s.id), "Subject deleted.")));
    row.append(nm, state, acts);
    return row;
  }

  /* ── One class ── */
  function classBlock(b, c) {
    const box = el("div", "cg-class");
    const head = el("div", "cg-row cg-class-head");
    const nm = nameCell(c.name, null, (v) => act(() => Cat.renameClass(b.id, c.id, v), "Class renamed."));
    const acts = el("div", "cg-acts");
    acts.append(btn("Rename", "btn-outline", () => nm.edit()));
    acts.append(btn("Delete", "btn-danger", () => remove("the class " + c.name, () => Cat.deleteClass(b.id, c.id), "Class deleted.")));
    head.append(nm, el("span"), acts);
    box.append(head);
    const subs = Cat.subjectList(b.id, c.id);
    if (!subs.length) box.append(el("div", "cg-empty", "No subjects yet."));
    subs.forEach((s) => box.append(subjectRow(b, c, s)));
    box.append(addForm("Add a subject", [
      { label: "Subject name", max: 40 }, { label: "Short code", max: 5, upper: true, width: "cg-code" }
    ], "Add subject", (v) => act(() => Cat.addSubject(b.id, c.id, v[0], v[1]),
      "Subject added. It is hidden from sign-up until you press Show on sign-up.")));
    return box;
  }

  /* ── One board ── */
  function boardCard(b) {
    const card = el("section", "portal-card cg-board");
    const head = el("div", "cg-row cg-board-head");
    const nm = nameCell(b.name, b.code, (v) => act(() => Cat.renameBoard(b.id, v), "Board renamed."));
    const acts = el("div", "cg-acts");
    acts.append(btn("Rename", "btn-outline", () => nm.edit()));
    acts.append(btn("Delete", "btn-danger", () => remove("the board " + b.name, () => Cat.deleteBoard(b.id), "Board deleted.")));
    head.append(nm, el("span"), acts);
    card.append(head);
    const classes = Cat.classList(b.id);
    if (!classes.length) card.append(el("div", "cg-empty", "No classes yet."));
    classes.forEach((c) => card.append(classBlock(b, c)));
    card.append(addForm("Add a class", [{ label: "Class name, e.g. Class 11", max: 40 }], "Add class",
      (v) => act(() => Cat.addClass(b.id, v[0]), "Class added.")));
    return card;
  }

  function render() {
    host.textContent = "";
    const head = el("div", "admin-head");
    const t = el("div");
    t.append(el("h2", null, "Catalog"),
      el("p", null, "Boards, classes and subjects of the test platform, and which subjects students can apply for."));
    head.append(t);
    host.append(head);

    const info = el("div", "message-box");
    info.textContent = "Every subject has its own access level (one board, one class, one subject). It is created with the subject and stays hidden from the sign-up form until you press Show on sign-up. A student can hold several access levels, which you give in Approvals and Students.";
    host.append(info);

    const boards = Cat.boardList();
    if (!boards.length) host.append(el("div", "a-empty", "The catalog is empty."));
    boards.forEach((b) => host.append(boardCard(b)));

    const add = el("section", "portal-card cg-board");
    add.append(addForm("Add a board, for example NEET or JEE", [
      { label: "Board name", max: 40 }, { label: "Short code", max: 8, upper: true, width: "cg-code" }
    ], "Add board", (v) => act(() => Cat.addBoard(v[0], v[1]), "Board added. Add its classes and subjects below it.")));
    host.append(add);

  }

  render();
  return { render: render };
}
