/* ─────────────────────────────────────────────────────────────────────
 * result-pdf.js  (ES module, Phase 10)
 * Turns an off-screen result report into a PDF in the student's browser.
 * The report is a container whose children each have the class "rp-block"
 * (a heading block, then one block per question). Each block is drawn with
 * its maths exactly as on screen, then placed on A4 pages without being cut
 * in the middle (a block taller than a page is sliced).
 * The two libraries are loaded from cdnjs only when a student asks for a PDF.
 * ───────────────────────────────────────────────────────────────────── */
const LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
];
let libsPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}
export function loadPdfLibs() {
  if (window.html2canvas && window.jspdf) return Promise.resolve();
  if (!libsPromise) {
    libsPromise = Promise.all(LIBS.map(loadScript)).catch((e) => { libsPromise = null; throw e; });
  }
  return libsPromise;
}

/* Waits for MathJax, typesets the report and waits for fonts and pictures. */
async function prepare(root) {
  if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
    try { await window.MathJax.startup.promise; } catch (e) { /* ignore */ }
  }
  if (window.MathJax && window.MathJax.typesetPromise) {
    try { await window.MathJax.typesetPromise([root]); } catch (e) { console.error(e); }
  }
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* ignore */ } }
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((res) => { im.onload = res; im.onerror = res; }))));
}

/* root: the report element (already in the page, off-screen). Returns a PDF Blob. */
export async function reportToPdf(root, onStep) {
  await loadPdfLibs();
  await prepare(root);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const PAGE_W = 210, PAGE_H = 297, MARGIN = 10;
  const W = PAGE_W - 2 * MARGIN, MAXY = PAGE_H - MARGIN;
  let y = MARGIN;
  const blocks = Array.from(root.querySelectorAll(":scope > .rp-block"));
  for (let i = 0; i < blocks.length; i++) {
    if (onStep) onStep(i + 1, blocks.length);
    const canvas = await window.html2canvas(blocks[i], {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: root.offsetWidth
    });
    const hMm = (canvas.height / canvas.width) * W;
    if (hMm <= MAXY - MARGIN) {
      if (y + hMm > MAXY && y > MARGIN) { pdf.addPage(); y = MARGIN; }
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN, y, W, hMm);
      y += hMm + 3;
    } else {
      /* A very tall block: slice it across pages. */
      const pageHpx = Math.floor(((MAXY - MARGIN) / W) * canvas.width);
      for (let top = 0; top < canvas.height; top += pageHpx) {
        const h = Math.min(pageHpx, canvas.height - top);
        const part = document.createElement("canvas");
        part.width = canvas.width; part.height = h;
        part.getContext("2d").drawImage(canvas, 0, top, canvas.width, h, 0, 0, canvas.width, h);
        if (y > MARGIN) { pdf.addPage(); y = MARGIN; }
        const pm = (h / canvas.width) * W;
        pdf.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN, y, W, pm);
        y += pm + 3;
      }
    }
  }
  /* Page numbers */
  const pages = pdf.getNumberOfPages();
  pdf.setFontSize(8);
  pdf.setTextColor(124, 130, 138);
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.text("Page " + p + " of " + pages, PAGE_W / 2, PAGE_H - 4, { align: "center" });
  }
  return pdf.output("blob");
}

export function pdfFileName(title) {
  const base = String(title || "mock-test").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "mock-test";
  return "Result-" + base + ".pdf";
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* True when this browser can share a PDF file through its share sheet (most phones). */
export function canShareFiles() {
  try {
    if (!navigator.share || !navigator.canShare) return false;
    const f = new File([new Blob(["x"], { type: "application/pdf" })], "x.pdf", { type: "application/pdf" });
    return navigator.canShare({ files: [f] });
  } catch (e) { return false; }
}

/* Opens the share sheet with the PDF. Resolves false if the student closed it. */
export async function shareBlob(blob, name, title, text) {
  const file = new File([blob], name, { type: "application/pdf" });
  try {
    await navigator.share({ files: [file], title: title, text: text });
    return true;
  } catch (e) {
    if (e && e.name === "AbortError") return false;
    throw e;
  }
}
