(function () {
  "use strict";

  /* ─────────────────────────────────────────────────────────────────
   * header-footer-loader.js
   * Injects the shared site header and footer into every page.
   *
   * HOW PATH RESOLUTION WORKS
   * --------------------------
   * We detect the page's depth relative to the site root by counting
   * how many directory segments are in the pathname, then build a
   * root-relative prefix accordingly:
   *
   *   /index.html              → depth 0 → prefix ""
   *   /pages/studyplanner/     → depth 2 → prefix "../../"
   *   /pages/courses/cbse12.html → depth 2 → prefix "../../"
   *
   * All asset hrefs (logo, icons, css, nav links) are built using
   * this prefix so they resolve correctly from any page location.
   *
   * NAV LINK STRATEGY
   * -----------------
   * Section anchors (#about, #faq, etc.) only work on the homepage.
   * From any other page we link to the root + anchor instead.
   * We detect "are we on the homepage" by checking if pathname is
   * exactly "/" or ends with "/index.html".
   * ───────────────────────────────────────────────────────────────── */

  /* ── 1. Compute path prefix ───────────────────────────────────── */
  function getPrefix() {
    var parts = window.location.pathname.replace(/^\//, "").split("/");
    // Filter empty segments (trailing slash, index.html at root, etc.)
    var dirs = parts.filter(function (p, i) {
      // Drop the last segment if it looks like a file (has a dot) or is empty
      if (i === parts.length - 1 && (p === "" || p.indexOf(".") !== -1)) return false;
      return p !== "";
    });
    var depth = dirs.length;
    if (depth === 0) return "";
    return new Array(depth + 1).join("../");
  }

  /* ── 2. Detect homepage ───────────────────────────────────────── */
  function isHomepage() {
    var p = window.location.pathname;
    return p === "/" || p === "/index.html" || p.endsWith("/index.html");
  }

  /* ── 3. Build anchor link ─────────────────────────────────────── */
  // On homepage: bare anchor. From any other page: root + anchor.
  function homeLink(anchor, prefix) {
    if (isHomepage()) return anchor;          // e.g. "#about"
    return prefix + "index.html" + anchor;   // e.g. "../../index.html#about"
  }

  /* ── 4. Render header HTML ────────────────────────────────────── */
  function buildHeader(prefix) {
    var home = isHomepage();

    // Logo / brand link: on homepage scroll to #top; elsewhere go home
    var brandHref = home ? "#top" : prefix + "index.html";

    return [
      '<header class="site-header" data-od-id="site-header">',
      '  <div class="container header-inner">',
      '    <div class="brand-container">',
      '      <a href="' + brandHref + '" class="brand-logo-link" data-od-id="brand-logo-link">',
      '        <img src="' + prefix + 'assets/images/logo.jpg" alt="Prof. Dr. S. Balaji Science Academy" class="brand-logo" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;display:block;" />',
      '      </a>',
      '      <a class="brand" href="' + brandHref + '" data-od-id="brand" id="brand-text">PROF. DR. S. BALAJI<br>SCIENCE ACADEMY</a>',
      '    </div>',

      '    <div class="header-right">',
      '      <nav class="nav-desktop" aria-label="Primary" data-od-id="nav-desktop">',
      '        <a href="' + homeLink("#about", prefix) + '">About</a>',
      '        <div class="nav-dropdown">',
      '          <button class="nav-dropdown-trigger" aria-haspopup="true" aria-expanded="false">Courses</button>',
      '          <div class="nav-dropdown-menu">',
      '            <a href="' + prefix + 'pages/courses/cbse10.html">CBSE Class 10</a>',
      '            <a href="' + prefix + 'pages/courses/cbse12.html">CBSE Class 12</a>',
      '            <a href="' + prefix + 'pages/courses/stateboard12.html">State Board Class 12</a>',
      '          </div>',
      '        </div>',
      '        <div class="nav-dropdown">',
      '          <button class="nav-dropdown-trigger" aria-haspopup="true" aria-expanded="false">Resources</button>',
      '          <div class="nav-dropdown-menu">',
      '            <a href="' + prefix + 'pages/studyplanner/">Study Planner</a>',
      '            <a href="' + prefix + 'pages/periodictable/">Periodic Table</a>',
      '            <a href="' + prefix + 'pages/mindmap/">Mind Map</a>',
      '          </div>',
      '        </div>',
      '        <a href="' + homeLink("#attend", prefix) + '">How to attend</a>',
      '        <a href="' + homeLink("#faq", prefix) + '">FAQs</a>',
      '        <a href="' + homeLink("#blog", prefix) + '">Blog</a>',
      '        <a href="' + homeLink("#contact", prefix) + '">Contact</a>',
      '      </nav>',
      '      <div class="nav-actions">',
      '        <a class="btn btn-primary" href="#" data-od-id="header-cta">Sign Up</a>',
      '      </div>',
      '    </div>',

      '    <a class="btn btn-primary btn-sm nav-actions-mobile" href="#" data-od-id="header-cta-mobile">Sign Up</a>',
      '    <button class="menu-toggle" id="menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav-mobile" data-od-id="menu-toggle">',
      '      <span></span>',
      '    </button>',
      '  </div>',
      '</header>',

      '<nav class="nav-mobile" id="nav-mobile" aria-label="Mobile">',
      '  <a href="' + homeLink("#about", prefix) + '">About</a>',
      '  <div class="nav-mobile-dropdown">',
      '    <button class="nav-mobile-dropdown-trigger" type="button" aria-expanded="false">Courses</button>',
      '    <div class="nav-mobile-dropdown-menu">',
      '      <a href="' + prefix + 'pages/courses/cbse10.html">CBSE Class 10</a>',
      '      <a href="' + prefix + 'pages/courses/cbse12.html">CBSE Class 12</a>',
      '      <a href="' + prefix + 'pages/courses/stateboard12.html">State Board Class 12</a>',
      '    </div>',
      '  </div>',
      '  <div class="nav-mobile-dropdown">',
      '    <button class="nav-mobile-dropdown-trigger" type="button" aria-expanded="false">Resources</button>',
      '    <div class="nav-mobile-dropdown-menu">',
      '      <a href="' + prefix + 'pages/studyplanner/">Study Planner</a>',
      '      <a href="' + prefix + 'pages/periodictable/">Periodic Table</a>',
      '      <a href="' + prefix + 'pages/mindmap/">Mind Map</a>',
      '    </div>',
      '  </div>',
      '  <a href="' + homeLink("#attend", prefix) + '">How to attend</a>',
      '  <a href="' + homeLink("#faq", prefix) + '">FAQs</a>',
      '  <a href="' + homeLink("#blog", prefix) + '">Blog</a>',
      '  <a href="' + homeLink("#contact", prefix) + '">Contact</a>',
      '</nav>'
    ].join("\n");
  }

  /* ── 5. Render footer HTML ────────────────────────────────────── */
  function buildFooter(prefix) {
    return [
      '<footer class="site-footer" data-od-id="footer">',
      '  <div class="container">',
      '    <div class="footer-top">',
      '      <div class="socials" data-od-id="socials">',
      '        <a href="tel:+919787692116" aria-label="Call">',
      '          <img src="' + prefix + 'assets/icons/call.svg" alt="Call" />',
      '        </a>',
      '        <a href="https://g.co/kgs/EkVWVxL" target="_blank" rel="noopener noreferrer" aria-label="Google Business">',
      '          <img src="' + prefix + 'assets/icons/google-business.svg" alt="Google Business" />',
      '        </a>',
      '        <a href="https://www.linkedin.com/in/profdrsbalaji" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">',
      '          <img src="' + prefix + 'assets/icons/linkedin.svg" alt="LinkedIn" />',
      '        </a>',
      '        <a href="mailto:prof@example.com" aria-label="Email">',
      '          <img src="' + prefix + 'assets/icons/mail.svg" alt="Email" />',
      '        </a>',
      '        <a href="https://scholar.google.co.kr/citations?hl=en&pli=1&user=9NAUZ5MAAAAJ" target="_blank" rel="noopener noreferrer" aria-label="Google Scholar">',
      '          <img src="' + prefix + 'assets/icons/google-scholar.svg" alt="Google Scholar" />',
      '        </a>',
      '        <a href="https://profbalaji.substack.com/" target="_blank" rel="noopener noreferrer" aria-label="Substack">',
      '          <img src="' + prefix + 'assets/icons/substack.png" alt="Substack" />',
      '        </a>',
      '        <a href="https://www.youtube.com/@CBSEdigest" target="_blank" rel="noopener noreferrer" aria-label="YouTube">',
      '          <img src="' + prefix + 'assets/icons/youtube.svg" alt="YouTube" />',
      '        </a>',
      '      </div>',
      '    </div>',
      '    <div class="footer-bottom" style="justify-content:space-between;flex-direction:column;align-items:center;gap:8px;">',
      '      <span style="font-size:12px;">© <span id="y"></span> Prof. Dr. S. Balaji Science Academy . All Rights Reserved.</span>',
      '    </div>',
      '  </div>',
      '</footer>'
    ].join("\n");
  }

  /* ── 6. Attach nav event listeners ───────────────────────────── */
  function attachNavListeners() {

    /* Hamburger toggle */
    var toggle = document.getElementById("menu-toggle");
    var mobileNav = document.getElementById("nav-mobile");
    if (toggle && mobileNav) {
      toggle.addEventListener("click", function () {
        var open = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!open));
        mobileNav.classList.toggle("open", !open);
        document.body.classList.toggle("nav-open", !open);
      });
      // Close mobile nav when any non-dropdown link is clicked
      mobileNav.querySelectorAll("a:not([aria-haspopup])").forEach(function (link) {
        link.addEventListener("click", function () {
          toggle.setAttribute("aria-expanded", "false");
          mobileNav.classList.remove("open");
          document.body.classList.remove("nav-open");
        });
      });
    }

    /* Mobile dropdowns — use querySelectorAll (there are two: Courses + Resources) */
    document.querySelectorAll(".nav-mobile-dropdown-trigger").forEach(function (trigger) {
      trigger.addEventListener("click", function () {
        var expanded = trigger.getAttribute("aria-expanded") === "true";
        trigger.setAttribute("aria-expanded", String(!expanded));
      });
    });

    /* Desktop dropdowns — use querySelectorAll (there are two: Courses + Resources) */
    document.querySelectorAll(".nav-dropdown").forEach(function (dropdown) {
      var trigger = dropdown.querySelector(".nav-dropdown-trigger");
      if (!trigger) return;

      trigger.addEventListener("click", function () {
        var expanded = trigger.getAttribute("aria-expanded") === "true";
        trigger.setAttribute("aria-expanded", String(!expanded));
      });

      // Close this dropdown when clicking outside it
      document.addEventListener("click", function (e) {
        if (!dropdown.contains(e.target)) {
          trigger.setAttribute("aria-expanded", "false");
        }
      });
    });
  }

  /* ── 7. Set copyright year in footer ─────────────────────────── */
  function setCopyrightYear() {
    var el = document.getElementById("y");
    if (el) el.textContent = new Date().getFullYear();
  }

  /* ── 8. Inject into the DOM ──────────────────────────────────── */
  function inject() {
    var prefix = getPrefix();

    /* Header: replace the static fallback placeholder */
    var headerSlot = document.getElementById("site-header-slot");
    if (headerSlot) {
      headerSlot.outerHTML = buildHeader(prefix);
    }

    /* Footer: replace the static fallback placeholder */
    var footerSlot = document.getElementById("site-footer-slot");
    if (footerSlot) {
      footerSlot.outerHTML = buildFooter(prefix);
    }

    attachNavListeners();
    setCopyrightYear();
  }

  /* Run after DOM is ready */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }

})();
