/* ─────────────────────────────────────────────────────────────────────
 * latex-tools.js  (ES module, no dependencies, no AI)
 * Helpers for the ProfAdmin question editor:
 *   - cleanPasted(text)   converts common Unicode symbols, sub/superscripts,
 *                         Word math characters and $...$ into the LaTeX the
 *                         site renders with MathJax (\( ... \) delimiters).
 *   - validateLatex(text) finds unbalanced braces and delimiters.
 *   - SYMBOL_GROUPS       the symbol toolbar contents.
 *   - insideMath / insertSnippet  cursor-aware insertion.
 * Text pasted from PDFs often arrives garbled; anything that cannot be
 * converted is reported back so it can be fixed by hand.
 * ───────────────────────────────────────────────────────────────────── */

const SUP = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n", "ⁱ": "i" };
const SUB = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")", "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x", "ᵢ": "i", "ⱼ": "j", "ₙ": "n", "ₘ": "m" };

const SUP_CLASS = "[" + Object.keys(SUP).join("") + "]";
const SUB_CLASS = "[" + Object.keys(SUB).join("") + "]";
const SUBDIGIT = "[₀-₉]";
const SUPDIGIT = "[⁰¹²³⁴⁵⁶⁷⁸⁹]";

/* One character → LaTeX command (used inside \( \)). */
const SYMBOLS = {
  "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\varepsilon", "ϵ": "\\epsilon", "ζ": "\\zeta", "η": "\\eta",
  "θ": "\\theta", "ϑ": "\\vartheta", "ι": "\\iota", "κ": "\\kappa", "λ": "\\lambda", "μ": "\\mu", "µ": "\\mu", "ν": "\\nu", "ξ": "\\xi",
  "π": "\\pi", "ρ": "\\rho", "σ": "\\sigma", "ς": "\\varsigma", "τ": "\\tau", "υ": "\\upsilon", "φ": "\\varphi", "ϕ": "\\phi",
  "χ": "\\chi", "ψ": "\\psi", "ω": "\\omega",
  "Γ": "\\Gamma", "Δ": "\\Delta", "Θ": "\\Theta", "Λ": "\\Lambda", "Ξ": "\\Xi", "Π": "\\Pi", "Σ": "\\Sigma", "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega",
  "Ω": "\\Omega",
  "±": "\\pm", "∓": "\\mp", "×": "\\times", "÷": "\\div", "⋅": "\\cdot", "·": "\\cdot", "∙": "\\cdot", "∗": "\\ast",
  "≤": "\\leq", "≥": "\\geq", "≠": "\\neq", "≈": "\\approx", "≅": "\\cong", "≡": "\\equiv", "∝": "\\propto", "∼": "\\sim", "≪": "\\ll", "≫": "\\gg",
  "∞": "\\infty", "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∬": "\\iint", "∮": "\\oint", "∂": "\\partial", "∇": "\\nabla", "√": "\\sqrt{}",
  "→": "\\rightarrow", "←": "\\leftarrow", "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow",
  "⇌": "\\rightleftharpoons", "↑": "\\uparrow", "↓": "\\downarrow",
  "∈": "\\in", "∉": "\\notin", "⊂": "\\subset", "⊃": "\\supset", "∪": "\\cup", "∩": "\\cap", "∅": "\\emptyset",
  "∴": "\\therefore", "∵": "\\because", "∠": "\\angle", "⊥": "\\perp", "∥": "\\parallel", "°": "^{\\circ}", "′": "'", "″": "''",
  "ℏ": "\\hbar", "ℓ": "\\ell", "Å": "\\text{\\AA}", "∀": "\\forall", "∃": "\\exists", "¼": "\\frac{1}{4}", "½": "\\frac{1}{2}", "¾": "\\frac{3}{4}"
};
const SYMBOL_CLASS = "[" + Object.keys(SYMBOLS).join("") + "]";

/* Characters that are safe to leave as plain text (not reported). */
const SAFE_NON_ASCII = /[\u00A0-\u00FF\u2010-\u2027\u2030-\u205E\u20B9\u2022\u2026\u0900-\u097F\u0B80-\u0BFF\n\t]/;

/* Count how many places a replace touches. */
function swap(state, text, re, fn) {
  return text.replace(re, function () {
    state.changes += 1;
    return fn.apply(null, arguments);
  });
}

export function cleanPasted(input) {
  const state = { changes: 0 };
  let t = String(input == null ? "" : input);
  const flags = [];

  /* 1. Whitespace and typography */
  t = t.replace(/\r\n?/g, "\n").replace(/[\u00A0\u2007\u202F\u2009\u200A]/g, " ").replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
  t = swap(state, t, /[\u2018\u2019]/g, () => "'");
  t = swap(state, t, /[\u201C\u201D]/g, () => "\"");
  t = swap(state, t, /[\u2013\u2014\u2212]/g, () => "-");

  /* 2. Word / "math italic" characters (U+1D400 – U+1D7FF) → plain letters */
  t = swap(state, t, /[\u{1D400}-\u{1D7FF}]/gu, (c) => c.normalize("NFKC"));

  /* 3. Dollar delimiters → \( \) and \[ \] */
  t = swap(state, t, /\$\$([^$]+?)\$\$/g, (m, a) => "\\[" + a.trim() + "\\]");
  t = swap(state, t, /\$([^$\n]+?)\$/g, (m, a) => "\\(" + a.trim() + "\\)");

  /* 4. Chemical formulae with Unicode subscripts or charges → \ce{ } */
  const elem = "(?:[A-Z][a-z]?" + SUBDIGIT + "*(?:" + SUPDIGIT + "?[⁺⁻](?!" + SUPDIGIT + "))?|\\([A-Za-z0-9₀-₉]+\\)" + SUBDIGIT + "*)";
  const chemRe = new RegExp("(?<![A-Za-z\\\\{])" + elem + "+(?![a-z])", "g");
  t = t.replace(chemRe, (m) => {
    if (!new RegExp(SUBDIGIT + "|[⁺⁻]").test(m)) return m;
    state.changes += 1;
    let out = m.replace(new RegExp("(" + SUPDIGIT + "?)([⁺⁻])", "g"), (x, d, s) => "^{" + (d ? SUP[d] : "") + SUP[s] + "}");
    out = out.replace(new RegExp(SUBDIGIT, "g"), (d) => SUB[d]);
    return "\\(\\ce{" + out + "}\\)";
  });

  /* 5. Superscripts and subscripts with a base: x² → \(x^{2}\) */
  const base = "([0-9]+(?:\\.[0-9]+)?|[A-Za-z]|\\)|\\])";
  t = swap(state, t, new RegExp(base + "(" + SUP_CLASS + "+)", "g"),
    (m, b, s) => "\\(" + b + "^{" + s.split("").map((c) => SUP[c]).join("") + "}\\)");
  t = swap(state, t, new RegExp(base + "(" + SUB_CLASS + "+)", "g"),
    (m, b, s) => "\\(" + b + "_{" + s.split("").map((c) => SUB[c]).join("") + "}\\)");
  /* Without a base (e.g. after a Greek letter, handled by the symbol step) */
  t = swap(state, t, new RegExp(SUP_CLASS + "+", "g"), (s) => "\\(^{" + s.split("").map((c) => SUP[c]).join("") + "}\\)");
  t = swap(state, t, new RegExp(SUB_CLASS + "+", "g"), (s) => "\\(_{" + s.split("").map((c) => SUB[c]).join("") + "}\\)");

  /* 6. Single symbols → \( \cmd \) (only outside existing math) */
  const parts = splitByMath(t);
  t = parts.map((p) => {
    if (p.math) return p.text;
    return p.text.replace(new RegExp(SYMBOL_CLASS, "g"), (c) => {
      state.changes += 1;
      return "\\(" + SYMBOLS[c] + "\\)";
    });
  }).join("");

  /* 7. Tidy: merge neighbouring math segments */
  t = t.replace(/\\\)\\\(/g, "");
  t = t.replace(/\\\) \\\(/g, " ");
  t = t.replace(/\\\(\^\{([^}]*)\}\\\)/g, "\\(^{$1}\\)");

  /* 8. Report anything left that we cannot place */
  const seen = {};
  Array.from(t).forEach((c) => {
    const cp = c.codePointAt(0);
    if (cp < 128 || SAFE_NON_ASCII.test(c) || seen[c]) return;
    /* Leave characters already inside math alone, but still report them */
    seen[c] = true;
    flags.push("Could not convert \"" + c + "\" (U+" + cp.toString(16).toUpperCase().padStart(4, "0") + "). Please type it as LaTeX.");
  });
  if (t.indexOf("\uFFFD") !== -1 && !seen["\uFFFD"]) flags.push("The text contains broken characters. It was probably copied from a PDF; please retype the affected part.");

  return { text: t, changes: state.changes, flags: flags };
}

/* Split text into alternating plain / math pieces ( \( \) , \[ \] ). */
function splitByMath(t) {
  const out = [];
  const re = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;
  let last = 0, m;
  while ((m = re.exec(t)) !== null) {
    if (m.index > last) out.push({ math: false, text: t.slice(last, m.index) });
    out.push({ math: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < t.length) out.push({ math: false, text: t.slice(last) });
  return out;
}

/* ── Validation ── returns [{ level: "error" | "warn", message }] */
export function validateLatex(text) {
  const issues = [];
  const t = String(text || "");
  if (!t.trim()) return issues;

  /* Braces (ignoring \{ and \} ) */
  let depth = 0, bad = false;
  const noEsc = t.replace(/\\[{}]/g, "  ");
  for (let i = 0; i < noEsc.length; i++) {
    const c = noEsc[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth < 0) { bad = true; depth = 0; } }
  }
  if (bad) issues.push({ level: "error", message: "A closing brace } has no matching opening brace {." });
  if (depth > 0) issues.push({ level: "error", message: depth + " opening brace" + (depth > 1 ? "s" : "") + " { not closed with }." });

  /* \( \) and \[ \] must alternate and balance, and not nest */
  const toks = [];
  const re = /\\\(|\\\)|\\\[|\\\]|\$\$|\$/g;
  let m;
  while ((m = re.exec(t)) !== null) toks.push(m[0]);
  let open = null;
  const closeFor = { "\\(": "\\)", "\\[": "\\]", "$$": "$$", "$": "$" };
  let delimOk = true;
  for (const tk of toks) {
    if (open === null) {
      if (tk === "\\)" ) { issues.push({ level: "error", message: "A closing \\) has no matching opening \\(." }); delimOk = false; }
      else if (tk === "\\]") { issues.push({ level: "error", message: "A closing \\] has no matching opening \\[." }); delimOk = false; }
      else open = tk;
    } else if (tk === closeFor[open]) {
      open = null;
    } else {
      issues.push({ level: "error", message: "Math delimiter " + tk + " found inside " + open + " ... " + closeFor[open] + ". Close the first one before opening another." });
      delimOk = false;
      break;
    }
  }
  if (open !== null && delimOk) issues.push({ level: "error", message: "The math started with " + open + " is not closed with " + closeFor[open] + "." });
  if (/\$/.test(t)) issues.push({ level: "warn", message: "A $ sign was found. Use \\( ... \\) for inline math; $ is not rendered as math on this site." });

  /* \begin / \end */
  const stack = [];
  const be = /\\(begin|end)\{([^}]*)\}/g;
  while ((m = be.exec(t)) !== null) {
    if (m[1] === "begin") stack.push(m[2]);
    else if (!stack.length || stack.pop() !== m[2]) { issues.push({ level: "error", message: "\\end{" + m[2] + "} does not match a \\begin." }); stack.length = 0; break; }
  }
  if (stack.length) issues.push({ level: "error", message: "\\begin{" + stack[stack.length - 1] + "} is not closed with \\end." });

  /* \left / \right */
  const lefts = (t.match(/\\left(?![a-zA-Z])/g) || []).length;
  const rights = (t.match(/\\right(?![a-zA-Z])/g) || []).length;
  if (lefts !== rights) issues.push({ level: "error", message: "\\left and \\right do not pair up (" + lefts + " and " + rights + ")." });

  /* \ce outside math */
  const outside = splitByMath(t).filter((p) => !p.math).map((p) => p.text).join(" ");
  if (/\\ce\s*\{/.test(outside)) issues.push({ level: "warn", message: "\\ce{...} is outside \\( \\). Wrap it as \\(\\ce{...}\\) so it renders." });
  const cmdOutside = outside.match(/\\(frac|sqrt|alpha|beta|theta|vec|hat|int|sum|partial|Delta|times|cdot)\b/);
  if (cmdOutside) issues.push({ level: "warn", message: "\\" + cmdOutside[1] + " is outside \\( \\) and will show as plain text." });

  return issues;
}

/* Is the cursor (index) inside \( \), \[ \] or $$ $$ ? */
export function insideMath(text, pos) {
  const before = text.slice(0, pos);
  const lastOpenI = before.lastIndexOf("\\("), lastCloseI = before.lastIndexOf("\\)");
  if (lastOpenI > lastCloseI) return true;
  const lastOpenD = before.lastIndexOf("\\["), lastCloseD = before.lastIndexOf("\\]");
  if (lastOpenD > lastCloseD) return true;
  const dollars = (before.match(/\$\$/g) || []).length;
  return dollars % 2 === 1;
}

/* Insert a snippet at the cursor. "|" in the snippet marks where the cursor
 * should land. Snippets are wrapped in \( \) when the cursor is outside math,
 * unless raw is true. Returns the new value; the caller sets it back. */
export function insertSnippet(textarea, snippet, raw) {
  const value = textarea.value;
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const selected = value.slice(start, end);
  let body = snippet;
  if (selected && body.indexOf("|") !== -1) body = body.replace("|", selected);
  const cursorIn = body.indexOf("|");
  let pre = "", post = "";
  if (!raw && !insideMath(value, start)) { pre = "\\("; post = "\\)"; }
  let inserted, caret;
  if (cursorIn === -1) {
    inserted = pre + body + post;
    caret = start + inserted.length;
  } else {
    inserted = pre + body.replace("|", "") + post;
    caret = start + pre.length + cursorIn;
  }
  textarea.focus();
  textarea.setSelectionRange(start, end);
  let done = false;
  try { done = document.execCommand("insertText", false, inserted); } catch (e) { done = false; }
  if (!done || textarea.value === value) {
    textarea.value = value.slice(0, start) + inserted + value.slice(end);
  }
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/* ── Toolbar content. Label is plain text (no typesetting needed). ── */
const g = (label, tex) => ({ label: label, tex: tex });
export const SYMBOL_GROUPS = [
  { name: "Greek", items: [
    g("α", "\\alpha"), g("β", "\\beta"), g("γ", "\\gamma"), g("δ", "\\delta"), g("ε", "\\varepsilon"), g("θ", "\\theta"),
    g("λ", "\\lambda"), g("μ", "\\mu"), g("ν", "\\nu"), g("π", "\\pi"), g("ρ", "\\rho"), g("σ", "\\sigma"), g("τ", "\\tau"),
    g("φ", "\\phi"), g("χ", "\\chi"), g("ψ", "\\psi"), g("ω", "\\omega"), g("η", "\\eta"), g("κ", "\\kappa"),
    g("Γ", "\\Gamma"), g("Δ", "\\Delta"), g("Θ", "\\Theta"), g("Λ", "\\Lambda"), g("Σ", "\\Sigma"), g("Φ", "\\Phi"), g("Ψ", "\\Psi"), g("Ω", "\\Omega")
  ]},
  { name: "Calculus", items: [
    g("a/b", "\\frac{|}{}"), g("√", "\\sqrt{|}"), g("ⁿ√", "\\sqrt[n]{|}"), g("xⁿ", "x^{|}"), g("xₙ", "x_{|}"),
    g("∫", "\\int_{|}^{}"), g("∮", "\\oint"), g("Σ", "\\sum_{i=1}^{|}"), g("d/dx", "\\frac{d}{dx}"), g("dy/dx", "\\frac{dy}{dx}"),
    g("∂/∂x", "\\frac{\\partial |}{\\partial x}"), g("d²y/dx²", "\\frac{d^{2}y}{dx^{2}}"), g("∇", "\\nabla"), g("lim", "\\lim_{x \\to |}"), g("∞", "\\infty"),
    g("±", "\\pm"), g("×", "\\times"), g("÷", "\\div"), g("·", "\\cdot"), g("≈", "\\approx"), g("≠", "\\neq"),
    g("≤", "\\leq"), g("≥", "\\geq"), g("∝", "\\propto"), g("∴", "\\therefore")
  ]},
  { name: "Vectors", items: [
    g("v⃗", "\\vec{|}"), g("v̂", "\\hat{|}"), g("v̄", "\\bar{|}"), g("v̇", "\\dot{|}"), g("v̈", "\\ddot{|}"),
    g("A⃗·B⃗", "\\vec{A} \\cdot \\vec{B}"), g("A⃗×B⃗", "\\vec{A} \\times \\vec{B}"), g("|A⃗|", "\\left| \\vec{|} \\right|"),
    g("î", "\\hat{i}"), g("ĵ", "\\hat{j}"), g("k̂", "\\hat{k}"), g("∇×", "\\nabla \\times"), g("∇·", "\\nabla \\cdot")
  ]},
  { name: "Arrows", items: [
    g("→", "\\rightarrow"), g("←", "\\leftarrow"), g("↔", "\\leftrightarrow"), g("⇒", "\\Rightarrow"), g("⇔", "\\Leftrightarrow"),
    g("⇌", "\\rightleftharpoons"), g("↑", "\\uparrow"), g("↓", "\\downarrow"), g("∈", "\\in"), g("⊥", "\\perp"), g("∥", "\\parallel"), g("∠", "\\angle")
  ]},
  { name: "Physics", items: [
    g("ℏ", "\\hbar"), g("ε₀", "\\varepsilon_{0}"), g("μ₀", "\\mu_{0}"), g("°", "^{\\circ}"), g("Ω", "\\Omega"),
    g("unit", "\\,\\mathrm{|}"), g("m s⁻¹", "\\,\\mathrm{m\\,s^{-1}}"), g("m s⁻²", "\\,\\mathrm{m\\,s^{-2}}"), g("N m", "\\,\\mathrm{N\\,m}"),
    g("μF", "\\,\\mathrm{\\mu F}"), g("×10ⁿ", "\\times 10^{|}"), g("text", "\\text{|}"), g("ΔE", "\\Delta E"), g("λ/2", "\\frac{\\lambda}{2}")
  ]},
  { name: "Chemistry", items: [
    g("ce{ }", "\\ce{|}"), g("A+B→C", "\\ce{A + B -> C}"), g("A⇌B", "\\ce{A <=> B}"), g("Fe³⁺", "\\ce{Fe^{3+}}"), g("SO₄²⁻", "\\ce{SO4^{2-}}"),
    g("→ Δ", "\\ce{->[\\Delta]}"), g("→ cat.", "\\ce{->[\\text{catalyst}]}"), g("↓", "\\ce{v}"), g("↑ gas", "\\ce{^}"),
    g("¹⁴₆C", "\\ce{^{14}_{6}C}"), g("(s)", "\\ce{(s)}"), g("(aq)", "\\ce{(aq)}"), g("(g)", "\\ce{(g)}"), g("(l)", "\\ce{(l)}")
  ]},
  { name: "Structure", items: [
    { label: "inline \\( \\)", tex: "\\(|\\)", raw: true }, { label: "display \\[ \\]", tex: "\\[|\\]", raw: true },
    g("( )", "\\left( | \\right)"), g("[ ]", "\\left[ | \\right]"), g("{ }", "\\left\\{ | \\right\\}"),
    g("cases", "\\begin{cases} | \\\\ \\end{cases}"), g("log", "\\log_{10} |"), g("ln", "\\ln |"), g("sin", "\\sin |"), g("cos", "\\cos |"), g("tan", "\\tan |")
  ]}
];
