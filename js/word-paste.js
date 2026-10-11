/* ─────────────────────────────────────────────────────────────────────
 * word-paste.js  (ES module, no AI)
 * Converts text copied from Microsoft Word into the LaTeX the site renders
 * with MathJax, so equations keep the structure they have in Word.
 *
 *   convertPaste(html, plain)  ->  { text, changes, flags }  or  null
 *
 * Order of work (owner decision, Word paste change):
 *   1. If Word's HTML clipboard carries its equation data (OMML), every
 *      equation is converted exactly (fractions, powers, subscripts, roots,
 *      brackets, sums, integrals, matrices ...). Word's subscript and
 *      superscript formatting is read from the same HTML.
 *   2. Otherwise Word's "linear" plain text, e.g. F_e=(ke^2)/r^2, is parsed
 *      by pattern: equations are found inside the sentences and converted.
 *   3. null is returned when there is nothing to do, so the existing paste
 *      cleaner (cleanPasted) runs exactly as before.
 *
 * Equations that sit in a line of text become \( ... \); an equation that
 * has its own line in Word (display equation) becomes \[ ... \], as in Word.
 * ───────────────────────────────────────────────────────────────────── */

import { cleanPasted, SYMBOLS, SUP, SUB } from "./latex-tools.js";

const TOK_OPEN = "\uE000", TOK_CLOSE = "\uE001";   // equation placeholders (HTML path)
const TQ0 = "\uE010", TQ1 = "\uE011";               // quoted-text placeholders (linear path)

/* An in-line equation longer than this is cut after its = signs (and other
 * relations) into several \( \) pieces, so it wraps like it does in Word
 * instead of running off the screen (MathJax 3 cannot wrap one equation). */
const SPLIT_MIN = 80;

/* ═════════════════════════ Shared character tables ═════════════════════════ */

const EXTRA = {
  "\u2212": "-", "\u2026": "\\ldots", "\u22EF": "\\cdots", "\u22EE": "\\vdots", "\u2206": "\\Delta",
  "\u2016": "\\Vert", "\u221A": "\\surd", "\u2218": "\\circ", "\u2295": "\\oplus", "\u2297": "\\otimes",
  "\u2227": "\\wedge", "\u2228": "\\vee", "\u00AC": "\\neg", "\u2286": "\\subseteq", "\u2287": "\\supseteq",
  "\u21A6": "\\mapsto", "\u2135": "\\aleph", "\u2216": "\\setminus", "\u27E8": "\\langle", "\u27E9": "\\rangle",
  "\u2308": "\\lceil", "\u2309": "\\rceil", "\u230A": "\\lfloor", "\u230B": "\\rfloor"
};

/* Commands that get a space on both sides (readability only). */
const BINREL = new Set(["\\times", "\\div", "\\pm", "\\mp", "\\cdot", "\\ast", "\\leq", "\\geq", "\\neq", "\\approx",
  "\\cong", "\\equiv", "\\propto", "\\sim", "\\ll", "\\gg", "\\rightarrow", "\\leftarrow", "\\leftrightarrow",
  "\\Rightarrow", "\\Leftarrow", "\\Leftrightarrow", "\\rightleftharpoons", "\\in", "\\notin", "\\subset",
  "\\supset", "\\cup", "\\cap", "\\therefore", "\\because", "\\oplus", "\\otimes", "\\wedge", "\\vee",
  "\\subseteq", "\\supseteq", "\\mapsto", "\\setminus", "\\circ"]);

/* Relations an in-line equation may be cut after. */
const REL_CMDS = new Set(["approx", "neq", "leq", "geq", "equiv", "propto", "cong", "ll", "gg", "rightarrow",
  "Rightarrow", "leftrightarrow", "Leftrightarrow", "rightleftharpoons"]);

const FUNCS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh", "tanh", "coth", "arcsin",
  "arccos", "arctan", "log", "ln", "lg", "exp", "det", "dim", "gcd", "lim", "max", "min", "sup", "inf",
  "limsup", "liminf", "ker", "deg", "arg"]);

const NARY = { "\u2211": "\\sum", "\u220F": "\\prod", "\u2210": "\\coprod", "\u222B": "\\int", "\u222C": "\\iint",
  "\u222D": "\\iiint", "\u222E": "\\oint", "\u22C3": "\\bigcup", "\u22C2": "\\bigcap", "\u22C1": "\\bigvee",
  "\u22C0": "\\bigwedge" };

const ACC = { "\u0302": "\\hat", "\u0303": "\\tilde", "\u0304": "\\bar", "\u0305": "\\overline", "\u0307": "\\dot",
  "\u0308": "\\ddot", "\u20D7": "\\vec", "\u030C": "\\check", "\u0301": "\\acute", "\u0300": "\\grave",
  "\u0306": "\\breve", "\u20DB": "\\dddot", "^": "\\hat", "~": "\\tilde", "\u00AF": "\\bar", "\u2192": "\\vec",
  "\u02D9": "\\dot", "\u00A8": "\\ddot" };

const DELIM = { "(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "|": "|", "\u2016": "\\Vert",
  "\u27E8": "\\langle", "\u27E9": "\\rangle", "\u2308": "\\lceil", "\u2309": "\\rceil", "\u230A": "\\lfloor",
  "\u230B": "\\rfloor", "/": "/", "\\": "\\backslash", "<": "\\langle", ">": "\\rangle" };

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function normChar(c) {
  const cp = c.codePointAt(0);
  if (cp === 0x1D716) return "\u03F5";                                // Word's italic epsilon symbol: keep the lunate shape
  if (cp >= 0x1D400 && cp <= 0x1D7FF) return c.normalize("NFKC");   // Word's math italic letters
  if (cp === 0x210E) return "h";
  return c;
}

/* One character (not a letter or digit) → LaTeX. */
function mapChar(c, inArr) {
  c = normChar(c);
  if (/\s/.test(c)) return "";
  if (c === "&") return inArr ? "&" : "\\&";
  let cmd = null;
  if (has(EXTRA, c)) cmd = EXTRA[c];
  else if (has(SYMBOLS, c)) cmd = SYMBOLS[c];
  if (cmd !== null) return BINREL.has(cmd) ? " " + cmd + " " : cmd;
  switch (c) {
    case "=": return " = ";
    case "<": return " < ";
    case ">": return " > ";
    case "{": return "\\{";
    case "}": return "\\}";
    case "#": return "\\#";
    case "%": return "\\%";
    case "$": return "\\$";
    case "_": return "\\_";
    case "~": return "\\sim ";
    case "^": return "\\wedge ";
    case "\\": return "\\backslash ";
    default: return c;
  }
}

/* Text for \text{ }: only characters MathJax's text mode accepts. */
function escText(s) {
  return String(s).replace(/[\\^~]/g, "").replace(/[{}$&#_%]/g, (c) => "\\" + c);
}

function smartJoin(parts) {
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(p)) out += " ";
    out += p;
  }
  return out;
}

/* Collapse stray spaces, but never touch the inside of \text{ }. */
function tidy(tex) {
  return String(tex).split(/(\\text\{[^{}]*\})/).map((seg, i) => {
    if (i % 2) return seg;
    return seg.replace(/\s+/g, " ").replace(/\{ /g, "{").replace(/ \}/g, "}");
  }).join("").trim();
}

function delimTex(ch, left) {
  if (ch === "") return ".";
  if (has(DELIM, ch)) return DELIM[ch];
  return left ? "(" : ")";
}

/* Cut a long in-line equation after its top-level relations. */
function splitAtRelations(tex) {
  if (tex.length <= SPLIT_MIN) return [tex];
  const out = [];
  let depth = 0, groups = 0, start = 0, i = 0;
  while (i < tex.length) {
    const ch = tex[i];
    if (ch === "\\") {
      const m = /^\\([A-Za-z]+)/.exec(tex.slice(i));
      if (m) {
        const name = m[1];
        i += m[0].length;
        if (name === "left" || name === "begin") groups++;
        else if (name === "right" || name === "end") groups = Math.max(0, groups - 1);
        else if (depth === 0 && groups === 0 && REL_CMDS.has(name)) { out.push(tex.slice(start, i)); start = i; }
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && groups === 0 && (ch === "=" || ch === "<" || ch === ">")) { out.push(tex.slice(start, i + 1)); start = i + 1; }
    i++;
  }
  if (start < tex.length) out.push(tex.slice(start));
  const pieces = out.map((s) => s.trim()).filter(Boolean);
  return pieces.length ? pieces : [tex];
}

function eqText(eq) {
  if (eq.display) return "\\[" + eq.tex + "\\]";
  return splitAtRelations(eq.tex).map((p) => "\\(" + p + "\\)").join(" ");
}

/* Same wording as the existing paste cleaner for characters it cannot place. */
const SAFE_NON_ASCII = /[\u00A0-\u00FF\u2010-\u2027\u2030-\u205E\u20B9\u2022\u2026\u0900-\u097F\u0B80-\u0BFF]/;
function flagsFor(tex) {
  const flags = [], seen = {};
  Array.from(tex).forEach((c) => {
    const cp = c.codePointAt(0);
    if (cp < 128 || SAFE_NON_ASCII.test(c) || seen[c]) return;
    seen[c] = true;
    flags.push("Could not convert \"" + c + "\" (U+" + cp.toString(16).toUpperCase().padStart(4, "0") + "). Please type it as LaTeX.");
  });
  return flags;
}

/* ═════════════════════════ Part 1: Word equations (OMML) ═════════════════════════ */

function decodeEntities(s) {
  const named = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'", nbsp: "\u00A0" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch (x) { return ""; }
    }
    const k = e.toLowerCase();
    return has(named, k) ? named[k] : m;
  });
}

/* A small parser that keeps only the m: (math) tags. Word wraps the math in
 * ordinary HTML (spans, italics, o:p); all of that is dropped first. */
function parseOmml(src) {
  const s = String(src)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[[^\]]*\]>/g, "")
    .replace(/<\/?(?!m:)[A-Za-z][^>]*>/gi, "");
  const root = { n: "#root", a: {}, c: [] };
  const stack = [root];
  const re = /<(\/?)(m:[A-Za-z0-9]+)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"'\/]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[5] !== undefined) {
      const top = stack[stack.length - 1];
      if (top.n === "m:t" || top.n === "m:r") top.c.push({ n: "#text", t: decodeEntities(m[5]) });
      continue;
    }
    const name = m[2].toLowerCase();
    if (m[1] === "/") {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].n === name) { stack.length = i; break; }
      continue;
    }
    const attrs = {};
    m[3].replace(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'\/]+)))?/g, (x, k, v1, v2, v3) => {
      const v = v1 !== undefined ? v1 : (v2 !== undefined ? v2 : v3);
      attrs[k.toLowerCase()] = v === undefined ? "" : decodeEntities(v);
      return "";
    });
    const node = { n: name, a: attrs, c: [] };
    stack[stack.length - 1].c.push(node);
    if (m[4] !== "/") stack.push(node);
  }
  return root;
}

const child = (node, name) => { if (!node) return null; for (let i = 0; i < node.c.length; i++) if (node.c[i].n === name) return node.c[i]; return null; };
const kids = (node, name) => (node ? node.c.filter((x) => x.n === name) : []);
const val = (n) => (n && n.a ? (n.a["m:val"] !== undefined ? n.a["m:val"] : (n.a.val !== undefined ? n.a.val : "")) : "");
const on = (n) => { if (!n) return false; const v = String(val(n) || "1").toLowerCase(); return !(v === "0" || v === "false" || v === "off"); };
function propVal(node, pr, item) {
  const p = child(node, pr), it = p ? child(p, item) : null;
  return it ? val(it) : undefined;
}
function rawText(node) {
  if (!node) return "";
  if (node.n === "#text") return node.t;
  if (node.n === "m:t") return node.c.map(rawText).join("");
  return node.c.map(rawText).join("");
}

const braced = (s) => "{" + String(s).trim() + "}";

function runTex(node, ctx) {
  const rpr = child(node, "m:rpr");
  const sty = rpr ? val(child(rpr, "m:sty")) : "";
  const nor = rpr ? on(child(rpr, "m:nor")) : false;
  const text = node.c.map((x) => (x.n === "m:t" || x.n === "#text" ? rawText(x) : "")).join("");
  return textTex(text, sty, nor, ctx);
}

function textTex(text, sty, nor, ctx) {
  if (!text) return "";
  if (nor) return "\\text{" + escText(text) + "}";
  const toks = Array.from(text).map((c) => (/^[A-Za-z0-9]$/.test(c) ? c : mapChar(c, ctx.inArr)));
  if (sty === "p" || sty === "b" || sty === "bi") {
    const wrap = sty === "p" ? "\\mathrm" : (sty === "b" ? "\\mathbf" : "\\boldsymbol");
    const out = [];
    let run = "";
    const flush = () => { if (run) { out.push(/[A-Za-z]/.test(run) ? wrap + "{" + run + "}" : run); run = ""; } };
    toks.forEach((t) => { if (/^[A-Za-z0-9]$/.test(t)) run += t; else { flush(); out.push(t); } });
    flush();
    return smartJoin(out);
  }
  return smartJoin(toks);
}

function seq(node, ctx) {
  const parts = [];
  if (!node) return "";
  node.c.forEach((ch) => { const p = one(ch, ctx); if (p) parts.push(p); });
  return smartJoin(parts);
}

function baseTex(eNode, ctx) {
  const real = eNode ? eNode.c.filter((x) => x.n !== "#text" && !/pr$/.test(x.n)) : [];
  const tex = tidy(seq(eNode, ctx));
  if (!tex) return "{}";
  if (real.length === 1 && real[0].n === "m:d") return tex;
  if (/^(?:[A-Za-z0-9]|[0-9]+(?:\.[0-9]+)?|[A-Za-z]+|\\[A-Za-z]+)$/.test(tex)) return tex;
  return braced(tex);
}

function one(ch, ctx) {
  const n = ch.n;
  if (n === "#text" || /pr$/.test(n)) return "";
  switch (n) {
    case "m:r": return runTex(ch, ctx);
    case "m:t": return textTex(rawText(ch), "", false, ctx);
    case "m:f": {
      const t = propVal(ch, "m:fpr", "m:type");
      const num = tidy(seq(child(ch, "m:num"), ctx)), den = tidy(seq(child(ch, "m:den"), ctx));
      if (t === "lin" || t === "skw") return braced(num) + "/" + braced(den);
      if (t === "nobar") return "\\genfrac{}{}{0pt}{}" + braced(num) + braced(den);
      return "\\frac" + braced(num) + braced(den);
    }
    case "m:ssup": return baseTex(child(ch, "m:e"), ctx) + "^" + braced(tidy(seq(child(ch, "m:sup"), ctx)));
    case "m:ssub": return baseTex(child(ch, "m:e"), ctx) + "_" + braced(tidy(seq(child(ch, "m:sub"), ctx)));
    case "m:ssubsup":
      return baseTex(child(ch, "m:e"), ctx) + "_" + braced(tidy(seq(child(ch, "m:sub"), ctx))) + "^" + braced(tidy(seq(child(ch, "m:sup"), ctx)));
    case "m:spre":
      return "{}_" + braced(tidy(seq(child(ch, "m:sub"), ctx))) + "^" + braced(tidy(seq(child(ch, "m:sup"), ctx))) + baseTex(child(ch, "m:e"), ctx);
    case "m:rad": {
      const hide = on(child(child(ch, "m:radpr"), "m:deghide"));
      const deg = tidy(seq(child(ch, "m:deg"), ctx)), e = tidy(seq(child(ch, "m:e"), ctx));
      return !hide && deg ? "\\sqrt[" + deg + "]" + braced(e) : "\\sqrt" + braced(e);
    }
    case "m:d": {
      const pr = child(ch, "m:dpr");
      const beg = pr && child(pr, "m:begchr") ? val(child(pr, "m:begchr")) : "(";
      const end = pr && child(pr, "m:endchr") ? val(child(pr, "m:endchr")) : ")";
      const sepRaw = pr && child(pr, "m:sepchr") ? val(child(pr, "m:sepchr")) : "|";
      const sep = sepRaw === "|" ? "\\mid " : mapChar(sepRaw, false);
      const inner = kids(ch, "m:e").map((e) => tidy(seq(e, ctx))).join(" " + sep + " ");
      return "\\left" + delimTex(beg, true) + " " + inner + " \\right" + delimTex(end, false);
    }
    case "m:nary": {
      const pr = child(ch, "m:narypr");
      const chrNode = pr ? child(pr, "m:chr") : null;
      const chr = chrNode ? val(chrNode) : "\u222B";
      const op = has(NARY, chr) ? NARY[chr] : (chr ? mapChar(chr, false) : "");
      const hideSub = on(pr && child(pr, "m:subhide")), hideSup = on(pr && child(pr, "m:suphide"));
      const lim = pr ? val(child(pr, "m:limloc")) : "";
      const isInt = /int|oint/.test(op);
      let s = op;
      if (lim === "undOvr" || lim === "undovr") s += "\\limits";
      else if (lim === "subSup" && !isInt) s += "\\nolimits";
      const sub = tidy(seq(child(ch, "m:sub"), ctx)), sup = tidy(seq(child(ch, "m:sup"), ctx));
      if (!hideSub && sub) s += "_" + braced(sub);
      if (!hideSup && sup) s += "^" + braced(sup);
      const e = tidy(seq(child(ch, "m:e"), ctx));
      return e ? s + " " + e : s;
    }
    case "m:func": {
      const fn = child(ch, "m:fname");
      const name = rawText(fn).replace(/\s+/g, "");
      const e = tidy(seq(child(ch, "m:e"), ctx));
      const simple = fn && !fn.c.some((x) => x.n !== "m:r" && !/pr$/.test(x.n));
      let f;
      if (simple && has2(FUNCS, name)) f = "\\" + name;
      else if (simple && name) f = "\\operatorname" + braced(name);
      else f = tidy(seq(fn, ctx));
      return e ? f + " " + e : f;
    }
    case "m:limlow": {
      const e = child(ch, "m:e"), name = rawText(e).replace(/\s+/g, "");
      const lim = tidy(seq(child(ch, "m:lim"), ctx));
      if (has2(FUNCS, name)) return "\\" + name + "\\limits_" + braced(lim);
      return "\\underset" + braced(lim) + braced(tidy(seq(e, ctx)));
    }
    case "m:limupp":
      return "\\overset" + braced(tidy(seq(child(ch, "m:lim"), ctx))) + braced(tidy(seq(child(ch, "m:e"), ctx)));
    case "m:acc": {
      const chrNode = child(child(ch, "m:accpr"), "m:chr");
      const chr = chrNode ? val(chrNode) : "\u0302";
      const cmd = has(ACC, chr) ? ACC[chr] : "\\hat";
      return cmd + braced(tidy(seq(child(ch, "m:e"), ctx)));
    }
    case "m:bar": {
      const pos = propVal(ch, "m:barpr", "m:pos");
      return (pos === "top" ? "\\overline" : "\\underline") + braced(tidy(seq(child(ch, "m:e"), ctx)));
    }
    case "m:groupchr": {
      const chrNode = child(child(ch, "m:groupchrpr"), "m:chr");
      const chr = chrNode ? val(chrNode) : "\u23DF";
      const pos = propVal(ch, "m:groupchrpr", "m:pos");
      const e = braced(tidy(seq(child(ch, "m:e"), ctx)));
      if (chr === "\u23DE") return "\\overbrace" + e;
      if (chr === "\u23DF") return "\\underbrace" + e;
      const sym = braced(mapChar(chr, false).trim());
      return (pos === "top" ? "\\overset" : "\\underset") + sym + e;
    }
    case "m:eqarr": {
      const inner = Object.assign({}, ctx, { inArr: true });
      const rows = kids(ch, "m:e").map((e) => tidy(seq(e, inner)));
      if (rows.length < 2) return (rows[0] || "").replace(/&/g, "");
      return "\\begin{aligned} " + rows.join(" \\\\ ") + " \\end{aligned}";
    }
    case "m:m": {
      const inner = Object.assign({}, ctx, { inArr: true });
      const rows = kids(ch, "m:mr").map((r) => kids(r, "m:e").map((e) => tidy(seq(e, inner))).join(" & "));
      return "\\begin{matrix} " + rows.join(" \\\\ ") + " \\end{matrix}";
    }
    case "m:borderbox": return "\\boxed" + braced(tidy(seq(child(ch, "m:e"), ctx)));
    case "m:phant": return seq(child(ch, "m:e"), ctx);
    default: return seq(ch, ctx);
  }
}
function has2(set, k) { return set.has(k); }

function collectMath(node, para, out) {
  node.c.forEach((ch) => {
    if (ch.n === "m:omathpara") collectMath(ch, true, out);
    else if (ch.n === "m:omath") {
      const tex = tidy(seq(ch, { inArr: false }));
      if (tex) out.push({ tex: tex, display: para });
    } else if (ch.n !== "#text") collectMath(ch, para, out);
  });
}

/* OMML source text → [{ tex, display }] */
export function ommlEquations(src) {
  const out = [];
  try { collectMath(parseOmml(src), false, out); } catch (e) { return []; }
  return out;
}

/* ═════════════════════════ Part 2: Word HTML → text ═════════════════════════ */

const SUP_REV = {}, SUB_REV = {};
Object.keys(SUP).forEach((k) => { SUP_REV[SUP[k]] = k; });
Object.keys(SUB).forEach((k) => { SUB_REV[SUB[k]] = k; });

const BLOCK = new Set(["p", "div", "li", "ul", "ol", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
  "pre", "section", "article", "header", "footer", "dt", "dd"]);
const SKIP = new Set(["head", "style", "script", "title", "meta", "link", "xml", "svg", "img", "noscript", "template", "o:p"]);

function looksLikeWord(html) {
  return /urn:schemas-microsoft-com:office|ProgId["']?\s*content=["']?Word|class=["']?Mso|<m:oMath|msEquation|content=["']?Microsoft Word/i.test(html || "");
}

function scriptKind(el) {
  const tag = el.localName ? el.localName.toLowerCase() : "";
  if (tag === "sub") return "sub";
  if (tag === "sup") return "sup";
  const st = (el.getAttribute && el.getAttribute("style")) || "";
  if (/vertical-align\s*:\s*sub/i.test(st)) return "sub";
  if (/vertical-align\s*:\s*super/i.test(st)) return "sup";
  return "";
}

function plainOf(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType !== 1) return "";
  const tag = (node.localName || "").toLowerCase();
  if (SKIP.has(tag)) return "";
  let s = "";
  for (let c = node.firstChild; c; c = c.nextSibling) s += plainOf(c);
  return s;
}

function ensureNewline(st) { if (st.out && !/\n$/.test(st.out)) st.out += "\n"; }

function emitScript(st, kind, raw) {
  const t = raw.replace(/\s+/g, "").replace(/\u2212/g, "-");
  if (!t) return;
  const rev = kind === "sup" ? SUP_REV : SUB_REV;
  const chars = Array.from(t);
  if (chars.every((c) => has(rev, c))) { st.out += chars.map((c) => rev[c]).join(""); return; }
  /* Not expressible as Unicode: take the letter, number or bracket just before it as the base. */
  const m = /([A-Z][a-z]?|[a-z]|[0-9]+(?:\.[0-9]+)?|\)|\])$/.exec(st.out);
  const base = m ? m[1] : "";
  if (m) st.out = st.out.slice(0, st.out.length - base.length);
  const body = /^[A-Za-z]{2,}$/.test(t) ? "\\mathrm{" + t + "}" : t.replace(/[{}\\]/g, "");
  st.out += "\\(" + base + (kind === "sup" ? "^" : "_") + "{" + body + "}\\)";
}

function walk(node, st) {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) {
      let t = c.nodeValue.replace(/[ \t\r\n\f]+/g, " ");
      if (!st.out || /\n$/.test(st.out)) t = t.replace(/^ /, "");
      else if (/ $/.test(st.out)) t = t.replace(/^ /, "");
      st.out += t;
      continue;
    }
    if (c.nodeType !== 1) continue;
    const tag = (c.localName || "").toLowerCase();
    if (SKIP.has(tag)) continue;
    const style = (c.getAttribute && c.getAttribute("style")) || "";
    if (/display\s*:\s*none|mso-hide\s*:\s*all/i.test(style)) continue;
    const kind = scriptKind(c);
    if (kind) { emitScript(st, kind, plainOf(c)); continue; }
    if (tag === "br") { st.out += "\n"; continue; }
    if (BLOCK.has(tag)) {
      ensureNewline(st);
      const before = st.out.length;
      walk(c, st);
      if (tag === "p" && st.out.slice(before).replace(/\s+/g, "") === "") st.out += "\n";
      if (tag === "tr") st.out = st.out.replace(/\t$/, "");
      ensureNewline(st);
      continue;
    }
    walk(c, st);
    if (tag === "td" || tag === "th") st.out += "\t";
  }
}

function htmlToText(body) {
  const st = { out: "" };
  walk(body, st);
  return st.out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "").replace(/[ \u00A0]+$/, "");
}

/* Returns { pieces } or null (not usable → try the plain text). */
function fromWordHtml(html, plain) {
  let frag = html;
  const a = frag.indexOf("<!--StartFragment-->"), b = frag.lastIndexOf("<!--EndFragment-->");
  if (a !== -1 && b > a) frag = frag.slice(a + "<!--StartFragment-->".length, b);

  const eqs = [];
  let failed = 0;
  const place = (src, fb) => {
    const list = ommlEquations(src).filter((eq) => /[A-Za-z0-9]/.test(eq.tex.replace(/\\[A-Za-z]+/g, "")));
    if (!list.length) {
      try { console.warn("Word paste: an equation could not be read. Start of its data:", String(src).slice(0, 1200)); } catch (e) { /* ignore */ }
      failed++; return fb ? fb.replace(/<!\[[^\]]*\]>/g, "") : ""; }
    return list.map((eq) => { eqs.push(eq); return TOK_OPEN + (eqs.length - 1) + TOK_CLOSE; }).join(" ");
  };
  frag = frag.replace(/<!--\s*\[if\s+gte\s+msEquation[^\]]*\]>([\s\S]*?)<!\[endif\]-->(\s*<!\[if\s+!msEquation\]>[\s\S]*?<!\[endif\]>)?/gi,
    (m, omml, fb) => place(omml, fb));
  frag = frag.replace(/<m:oMathPara\b[\s\S]*?<\/m:oMathPara>|<m:oMath\b[\s\S]*?<\/m:oMath>/gi, (m) => place(m, ""));

  if (failed) return null;                              // equation data unreadable: use the plain text
  const hasSubSup = /<su[bp][\s>]|vertical-align\s*:\s*(?:sub|super)/i.test(frag);
  const orphanFallback = /<!\[if\s+!msEquation\]>/i.test(frag);
  if (!eqs.length && !hasSubSup) return null;
  if (!eqs.length && orphanFallback) return null;      // equations arrived as pictures only
  if (typeof DOMParser === "undefined") return null;

  const src = /<body[\s>]/i.test(frag) ? frag : "<body>" + frag + "</body>";
  const doc = new DOMParser().parseFromString(src, "text/html");
  if (!doc || !doc.body) return null;
  const text = htmlToText(doc.body);

  const pieces = [];
  const re = new RegExp(TOK_OPEN + "(\\d+)" + TOK_CLOSE, "g");
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) pieces.push({ math: false, text: text.slice(last, m.index) });
    pieces.push({ math: true, tex: eqs[+m[1]].tex, display: eqs[+m[1]].display });
    last = m.index + m[0].length;
  }
  if (last < text.length) pieces.push({ math: false, text: text.slice(last) });

  /* No Word equations: equations typed as linear text may still be in the prose. */
  if (!eqs.length) {
    const lin = linearPieces(text);
    return { pieces: lin ? lin.pieces : pieces, failed: failed };
  }
  return { pieces: pieces, failed: failed };
}

/* ═════════════════════════ Part 3: Word's linear text → LaTeX ═════════════════════════ */

const delim = (inner) => (/\\frac|\\sqrt|\^|_|\\sum|\\int|\\prod|\\begin/.test(inner) ? "\\left(" + inner + "\\right)" : "(" + inner + ")");

function splitTop(str, sep) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) { out.push(str.slice(start, i)); start = i + 1; }
  }
  out.push(str.slice(start));
  return out;
}

class Lin {
  constructor(s, quotes) { this.s = s; this.i = 0; this.q = quotes || []; }

  all() { return tidy(this.seq("")); }

  seq(stops) {
    const parts = [];
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (/\s/.test(c)) { this.i++; continue; }
      if (stops && stops.indexOf(c) !== -1) break;
      const u = this.unit();
      if (u === null) { this.i++; continue; }
      parts.push(u);
    }
    return smartJoin(parts);
  }

  /* operand, then any fractions: a/b */
  unit() {
    let first = this.operand(false);
    if (first === null) return null;
    while (this.s[this.i] === "/") {
      const save = this.i;
      this.i++;
      const den = this.operand(true);
      if (!den) { this.i = save + 1; first = { tex: first.tex + "/" }; break; }
      first = { tex: "\\frac" + braced(first.paren ? first.inner : first.tex) + braced(den.paren ? den.inner : den.tex) };
    }
    return first.tex;
  }

  match(i) {
    let d = 0;
    for (let k = i; k < this.s.length; k++) {
      const ch = this.s[k];
      if (ch === "(") d++;
      else if (ch === ")") { d--; if (d === 0) return k; }
    }
    return -1;
  }

  group() {
    this.i++;
    const inner = this.seq(")");
    let closed = false;
    if (this.s[this.i] === ")") { this.i++; closed = true; }
    return { inner: inner, closed: closed };
  }

  quote() {
    const m = /^\uE010(\d+)\uE011/.exec(this.s.slice(this.i));
    if (!m) { this.i++; return null; }
    this.i += m[0].length;
    return "\\text{" + escText(this.q[+m[1]] || "") + "}";
  }

  script() {
    const s = this.s, c = s[this.i];
    if (c === undefined) return null;
    if (c === "(") { const g = this.group(); return g.closed ? g.inner : "(" + g.inner; }
    const rest = s.slice(this.i);
    let m = /^[+\-\u2212]?[0-9]+(?:\.[0-9]+)?/.exec(rest);
    if (m) { this.i += m[0].length; return m[0].replace("\u2212", "-"); }
    m = /^[+\-\u2212]?[A-Za-z]+/.exec(rest);
    if (m) { this.i += m[0].length; return m[0].replace("\u2212", "-"); }
    if (c === TQ0) return this.quote();
    const cmd = has(EXTRA, c) ? EXTRA[c] : (has(SYMBOLS, c) ? SYMBOLS[c] : null);
    if (cmd && /^\\[A-Za-z]+$/.test(cmd) && !BINREL.has(cmd)) { this.i++; return cmd; }
    if (c === "+" || c === "-" || c === "\u2212") { this.i++; return c === "\u2212" ? "-" : c; }
    return null;
  }

  accent(atom) {
    const a = ACC[this.s[this.i]];
    if (a && this.s[this.i] !== "^" && this.s[this.i] !== "~" && this.s[this.i] !== "\u2192") {
      this.i++;
      atom.tex = a + braced(atom.tex);
    }
    return atom;
  }

  sqrt(c) {
    this.i++;
    let idx = c === "\u221B" ? "3" : (c === "\u221C" ? "4" : null), body;
    if (this.s[this.i] === "(") {
      const j = this.match(this.i);
      const inner = this.s.slice(this.i + 1, j === -1 ? this.s.length : j);
      this.i = j === -1 ? this.s.length : j + 1;
      const parts = splitTop(inner, "&");
      if (parts.length === 2 && idx === null) { idx = new Lin(parts[0], this.q).all(); body = new Lin(parts[1], this.q).all(); }
      else body = new Lin(inner, this.q).all();
    } else {
      const o = this.operand(true);
      body = o ? o.tex : "";
    }
    return { tex: idx ? "\\sqrt[" + idx + "]" + braced(body) : "\\sqrt" + braced(body) };
  }

  matrix(c) {
    this.i++;
    if (this.s[this.i] !== "(") return { tex: "" };
    const j = this.match(this.i);
    const inner = this.s.slice(this.i + 1, j === -1 ? this.s.length : j);
    this.i = j === -1 ? this.s.length : j + 1;
    const env = c === "\u25A0" ? "matrix" : "aligned";
    const body = splitTop(inner, "@").map((r) => splitTop(r, "&").map((cell) => new Lin(cell, this.q).all()).join(" & ")).join(" \\\\ ");
    return { tex: "\\begin{" + env + "} " + body + " \\end{" + env + "}" };
  }

  /* an atom with its subscript and superscript */
  operand(denMode) {
    const s = this.s, c = s[this.i];
    if (c === undefined) return null;
    let atom = null, canScript = true;
    if (c === "(") {
      const g = this.group();
      atom = { tex: g.closed ? delim(g.inner) : "(" + g.inner, paren: g.closed, inner: g.inner };
    } else if (c === TQ0) {
      const q = this.quote();
      if (q === null) return { tex: "" };
      atom = { tex: q }; canScript = false;
    } else if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?/.exec(s.slice(this.i));
      this.i += m[0].length;
      atom = { tex: m[0].replace(/,/g, "{,}") };
    } else if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z]+/.exec(s.slice(this.i));
      if (m[0].length > 1 && FUNCS.has(m[0])) { this.i += m[0].length; atom = { tex: "\\" + m[0] }; }
      else { this.i++; atom = this.accent({ tex: c }); }
    } else if (/[\u00C0-\u017F]/.test(c) && /^[A-Za-z][\u0300-\u036F]$/.test(c.normalize("NFD")) && ACC[c.normalize("NFD")[1]]) {
      this.i++;
      const d = c.normalize("NFD");
      atom = { tex: ACC[d[1]] + braced(d[0]) };
    } else if (c === "|" && !denMode && s.indexOf("|", this.i + 1) > this.i + 1) {
      const j = s.indexOf("|", this.i + 1);
      const inner = new Lin(s.slice(this.i + 1, j), this.q).all();
      this.i = j + 1;
      atom = { tex: /\\frac|\\sqrt|\^|_/.test(inner) ? "\\left|" + inner + "\\right|" : "|" + inner + "|" };
    } else if (c === "\u221A" || c === "\u221B" || c === "\u221C") {
      atom = this.sqrt(c); canScript = false;
    } else if (c === "\u25A0" || c === "\u2588") {
      atom = this.matrix(c); canScript = false;
    } else if (c === "\u2146" || c === "\u2147" || c === "\u2148" || c === "\u2149") {
      this.i++;
      atom = { tex: "\\mathrm{" + { "\u2146": "d", "\u2147": "e", "\u2148": "i", "\u2149": "j" }[c] + "}" };
    } else {
      if (denMode) return null;
      this.i++;
      const cmd = has(EXTRA, c) ? EXTRA[c] : (has(SYMBOLS, c) ? SYMBOLS[c] : null);
      if (cmd && /^\\[A-Za-z]+$/.test(cmd) && !BINREL.has(cmd)) atom = { tex: cmd };
      else return { tex: mapChar(c, false) };
    }
    if (canScript) {
      let sub = null, sup = null;
      for (;;) {
        const ch = this.s[this.i];
        if (ch === "_" && sub === null) {
          this.i++;
          const o = this.script();
          if (o === null) { this.i--; break; }
          sub = o;
        } else if (ch === "^" && sup === null) {
          this.i++;
          const o = this.script();
          if (o === null) { this.i--; break; }
          sup = o;
        } else break;
      }
      if (sub !== null || sup !== null) {
        atom = { tex: atom.tex + (sub !== null ? "_" + braced(sub) : "") + (sup !== null ? "^" + braced(sup) : "") };
      }
    }
    return atom;
  }
}

/* ── finding equations inside a line of plain text ── */

const STRONG_CH = /[=\u2248\u2260\u2264\u2265\u00D7\u00F7\u00B1\u2211\u222B\u220F\u221A\u221B\u221C\u221E\u221D\u2192\u21D2\u21D4\u21CC\u2202\u2207\u2261\u223C\u2245\u226A\u226B\u2208\u2209\u2282\u2283\u222A\u2229\u22A5\u2225\u2234\u2235\u2146\u2147]/;

function classify(tok) {
  const core = tok.replace(/[.,;:!?]+$/, "");
  if (!core) return "prose";
  if (/:\/\/|^www\.|[A-Za-z0-9._-]+@[A-Za-z0-9-]+\./.test(core)) return "prose";
  if (/^\uE010\d+\uE011$/.test(core)) return "quote";
  if (STRONG_CH.test(core)) return "strong";
  if (/_/.test(core) && !/[A-Za-z]{2,}_[A-Za-z]{2,}/.test(core) && /[A-Za-z0-9)\]]_[A-Za-z0-9(]/.test(core)) return "strong";
  if (/[A-Za-z0-9)\]]\^[(A-Za-z0-9+\-\u2212]/.test(core)) return "strong";
  if (/\)\/|\/\(/.test(core)) return "strong";
  if (/\uE010/.test(core)) return "weak";
  if (/^[0-9]+(?:[.,][0-9]+)*$/.test(core)) return "weak";
  if (/^[A-Za-z][\u0300-\u036F\u20D0-\u20FF]?$/.test(core) || /^[0-9]+(?:\.[0-9]+)?[A-Za-z]$/.test(core)) return "weak";
  if (/^[\u0391-\u03C9]+$/.test(core)) return "weak";
  if (/^[()\[\]0-9.,+\-\u2212*\/<>|]+$/.test(core)) return "weak";
  return "prose";
}

const OP_START = /^[=+\-\u2212\u00D7\u00F7*\/<>\u2248\u2260\u2264\u2265\u221D^_)\]]/;
const OP_END = /[=+\-\u2212\u00D7\u00F7*\/<>\u2248\u2260\u2264\u2265(,]$/;

function convertLine(line, quotes) {
  line = line.replace(/\s+([\u0300-\u036F\u20D0-\u20FF])/g, "$1");     // Word may put a space before an accent mark
  const prot = line.replace(/"([^"\n]{1,24})"/g, (m, q) => { quotes.push(q); return TQ0 + (quotes.length - 1) + TQ1; });
  const unprotect = (str) => str.replace(/\uE010(\d+)\uE011/g, (m, i) => "\"" + quotes[+i] + "\"");
  const toks = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(prot)) !== null) toks.push({ t: m[0], s: m.index, e: m.index + m[0].length, k: classify(m[0]) });
  if (!toks.some((t) => t.k === "strong")) return null;

  const mathy = (k) => k === "strong" || k === "weak" || k === "quote";
  const pieces = [];
  let i = 0, last = 0, found = 0;
  while (i < toks.length) {
    if (!mathy(toks[i].k)) { i++; continue; }
    let j = i;
    while (j + 1 < toks.length && mathy(toks[j + 1].k)) j++;
    let a = i, b = j;
    while (a < b && toks[a].k !== "strong" && !OP_START.test(toks[a + 1].t)) a++;
    while (b > a && toks[b].k === "weak" && /^[A-Za-z]$/.test(toks[b].t.replace(/[.,;:!?]+$/, "")) && !OP_END.test(toks[b - 1].t)) b--;
    let ok = false;
    for (let x = a; x <= b; x++) if (toks[x].k === "strong") ok = true;
    if (!ok) { i = j + 1; continue; }
    let runText = prot.slice(toks[a].s, toks[b].e);
    const trail = (/[.,;:!?]+$/.exec(runText) || [""])[0];
    runText = runText.slice(0, runText.length - trail.length);
    const tex = new Lin(runText, quotes).all();
    if (tex) {
      pieces.push({ math: false, text: unprotect(prot.slice(last, toks[a].s)) });
      pieces.push({ math: true, tex: tex, display: false });
      last = toks[b].e - trail.length;
      found++;
    }
    i = j + 1;
  }
  if (!found) return null;
  pieces.push({ math: false, text: unprotect(prot.slice(last)) });
  return pieces;
}

/* Pieces for a whole text, or null when no equation was found. */
function linearPieces(plain) {
  if (/[\\$]/.test(plain) || plain.indexOf(TOK_OPEN) !== -1) return null;   // already LaTeX: leave to the old cleaner
  const quotes = [];
  const pieces = [];
  let n = 0;
  plain.split(/\r\n|\r|\n/).forEach((line, idx) => {
    if (idx) pieces.push({ math: false, text: "\n" });
    const r = convertLine(line, quotes);
    if (r) { r.forEach((p) => pieces.push(p)); n += r.filter((p) => p.math).length; }
    else pieces.push({ math: false, text: line });
  });
  return n ? { pieces: pieces, n: n } : null;
}

/* ═════════════════════════ Putting it together ═════════════════════════ */

function assemble(pieces, failed) {
  let text = "", changes = 0;
  const flags = [];
  const add = (list) => list.forEach((f) => { if (flags.indexOf(f) === -1) flags.push(f); });
  pieces.forEach((p) => {
    if (p.math) {
      text += eqText(p);
      changes += 1;
      add(flagsFor(p.tex));
    } else if (p.text) {
      const r = cleanPasted(p.text);
      text += r.text;
      changes += r.changes;
      add(r.flags);
    }
  });
  if (failed) add([failed + " equation" + (failed === 1 ? "" : "s") + " could not be read from Word. Please check the preview and retype it if needed."]);
  return { text: text, changes: changes, flags: flags };
}

export function convertPaste(html, plain) {
  html = html || "";
  plain = plain || "";
  if (html && looksLikeWord(html)) {
    const r = fromWordHtml(html, plain);
    if (r) return assemble(r.pieces, r.failed);
  }
  if (!plain) return null;
  const lin = linearPieces(plain);
  return lin ? assemble(lin.pieces, 0) : null;
}
