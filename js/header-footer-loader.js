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
      '<style id="hfl-styles">',
      '  .brand-container { display:flex; flex-direction:row; align-items:center; gap:10px; flex-shrink:0; margin-right:auto; }',
      '  .brand-logo-link { display:flex; align-items:center; justify-content:center; text-decoration:none; border-radius:50%; flex-shrink:0; transition:opacity 150ms; }',
      '  .brand-logo-link:hover { opacity:0.8; }',
      '  .brand-logo { width:40px; height:40px; border-radius:50%; object-fit:cover; flex-shrink:0; display:block; }',
      '  @media (min-width:480px) { .brand-logo { width:44px; height:44px; } }',
      '  @media (min-width:896px) { .brand-logo { width:48px; height:48px; } }',
      '  #brand-text { font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--fg); text-decoration:none; line-height:1.25; flex-shrink:1; }',
      '  #brand-text:hover { color:var(--fg); }',
      '  @media (min-width:896px) { #brand-text br { display:none; } #brand-text { white-space:nowrap; font-size:13px; } }',
      '  .user-menu { position:relative; }',
      '  .user-menu-btn { display:inline-flex; align-items:center; gap:8px; min-height:40px; padding:4px 14px 4px 4px; border-radius:9999px; background:var(--surface); color:var(--fg); font-family:var(--font-body); font-size:14px; font-weight:600; border:1px solid transparent; cursor:pointer; transition:background 150ms; }',
      '  .user-menu-btn:hover { background:color-mix(in oklab, var(--surface), var(--fg) 6%); }',
      '  .user-avatar { width:32px; height:32px; border-radius:50%; background:var(--accent); color:var(--accent-on); display:grid; place-items:center; font-size:14px; font-weight:600; flex-shrink:0; }',
      '  .user-name { max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
      '  .user-menu-panel { display:none; position:absolute; right:0; top:calc(100% + 8px); min-width:224px; background:var(--bg); border:1px solid var(--border); border-radius:16px; padding:8px; box-shadow:0 4px 12px rgba(0,0,0,0.04); z-index:120; }',
      '  .user-menu-btn[aria-expanded="true"] + .user-menu-panel { display:block; }',
      '  .user-menu-id { display:flex; flex-direction:column; gap:2px; padding:8px 12px 12px; margin-bottom:4px; border-bottom:1px solid var(--border); font-size:14px; }',
      '  .user-menu-id strong { font-weight:600; overflow-wrap:anywhere; }',
      '  .user-menu-id span { color:var(--muted); font-size:12px; overflow-wrap:anywhere; }',
      '  .user-menu-panel a, .user-menu-panel button { display:block; width:100%; text-align:left; padding:10px 12px; border-radius:8px; font-family:var(--font-body); font-size:14px; font-weight:500; color:var(--fg); text-decoration:none; background:none; border:0; cursor:pointer; }',
      '  .user-menu-panel a:hover, .user-menu-panel button:hover { background:var(--surface); }',
      '  @media (max-width:895px) { .user-name { display:none; } .user-menu-btn { width:40px; padding:4px; justify-content:center; } }',
      '</style>',

      '<header class="site-header" data-od-id="site-header">',
      '  <div class="container header-inner">',
      '    <div class="brand-container">',
      '      <a href="' + brandHref + '" class="brand-logo-link" data-od-id="brand-logo-link">',
      '        <img src="' + prefix + 'assets/images/logo.jpg" alt="Prof. Dr. S. Balaji Science Academy" class="brand-logo" />',
      '      </a>',
      '      <a class="brand" href="' + brandHref + '" data-od-id="brand" id="brand-text">PROF. DR. S. BALAJI <br>SCIENCE ACADEMY</a>',
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
      '            <a href="' + prefix + 'pages/test.html">Mock Tests</a>',
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
      '        <a class="btn btn-primary" href="' + prefix + 'auth/" data-od-id="header-cta">Sign In</a>',
      '      </div>',
      '    </div>',

      '    <a class="btn btn-primary btn-sm nav-actions-mobile" href="' + prefix + 'auth/" data-od-id="header-cta-mobile">Sign In</a>',
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
      '      <a href="' + prefix + 'pages/test.html">Mock Tests</a>',
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
      '        <a href="mailto:contact@profbalaji.in" aria-label="Email">',
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
      '      <span style="font-size:11px;">© <span id="y"></span> Prof. Dr. S. Balaji Science Academy | All Rights Reserved.</span>',
      '      <span class="footer-legal" style="display:flex;flex-wrap:wrap;justify-content:center;gap:16px;font-size:12px;">'
        + '<a href="' + prefix + 'pages/privacy.html">Privacy Policy</a>'
        + '<a href="' + prefix + 'pages/terms.html">Terms of Use</a></span>',
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

  /* ── 8. Brand text scroll-fade ────────────────────────────────
   * Opacity is set directly on every scroll frame — no CSS transition —
   * so it tracks finger/wheel speed physically.
   *
   * Fade window: 0 → FADE_OVER px of scrollY.
   * At 0px  → opacity 1 (fully visible)
   * At FADE_OVER → opacity 0 (fully gone)
   *
   * The header is position:sticky so it never moves, but scrollY still
   * increases. We simply drive #brand-text opacity from scrollY.
   * ─────────────────────────────────────────────────────────────── */
  function attachBrandFade() {
    /* Look up after injection — outerHTML swap creates new DOM nodes */
    var brandEl = document.getElementById("brand-text");
    if (!brandEl) return;

    /* Fade completes over the first 72px of scroll (= header height) */
    var FADE_OVER = 72;
    var ticking = false;

    function applyFade() {
      var scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
      var opacity = Math.max(0, Math.min(1, 1 - scrollY / FADE_OVER));
      brandEl.style.opacity = String(opacity);
      brandEl.setAttribute("aria-hidden", opacity === 0 ? "true" : "false");
      ticking = false;
    }

    window.addEventListener("scroll", function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(applyFade);
      }
    }, { passive: true });

    /* Apply immediately so restored-scroll-position pages start correct */
    applyFade();
  }

  /* ── 8b. Sign-in state in the header ─────────────────────────
   * Header shows "Sign In" until Firebase reports a signed-in user, then
   * swaps to a user menu (Dashboard, Sign Out). Header needs no database
   * reads: the Dashboard link routes students/admins to the right place.
   * A tiny localStorage hint avoids a "Sign In" flash for returning users.
   * ─────────────────────────────────────────────────────────────── */
  var loginHref = "";
  var dashHref = "";

  function esc(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function userMenuHTML(u) {
    var label = u.name || (u.email ? u.email.split("@")[0] : "Account");
    var initial = esc(label.charAt(0).toUpperCase());
    return [
      '<div class="user-menu" data-user-menu>',
      '  <button class="user-menu-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">',
      '    <span class="user-avatar" aria-hidden="true">' + initial + '</span>',
      '    <span class="user-name">' + esc(label) + '</span>',
      '  </button>',
      '  <div class="user-menu-panel">',
      '    <div class="user-menu-id"><strong>' + esc(label) + '</strong><span>' + esc(u.email || "") + '</span></div>',
      '    <a href="' + dashHref + '">Dashboard</a>',
      '    <button type="button" data-signout>Sign Out</button>',
      '  </div>',
      '</div>'
    ].join("");
  }

  function applyAuth(user) {
    var desktop = document.querySelector(".nav-actions");
    var mobile = document.querySelector('[data-od-id="header-cta-mobile"]');
    if (!desktop || !mobile) return;
    if (user) {
      desktop.innerHTML = userMenuHTML(user);
      mobile.outerHTML = '<div class="nav-actions-mobile" data-od-id="header-cta-mobile">' + userMenuHTML(user) + '</div>';
    } else {
      desktop.innerHTML = '<a class="btn btn-primary" href="' + loginHref + '" data-od-id="header-cta">Sign In</a>';
      mobile.outerHTML = '<a class="btn btn-primary btn-sm nav-actions-mobile" href="' + loginHref + '" data-od-id="header-cta-mobile">Sign In</a>';
    }
  }

  function readHint() {
    try {
      var h = JSON.parse(localStorage.getItem("pb_user_hint") || "null");
      return h && (h.name || h.email) ? h : null;
    } catch (e) { return null; }
  }

  function initAuthHeader(prefix) {
    loginHref = prefix + "auth/";
    dashHref = prefix + "pages/dashboard/";

    /* One delegated handler covers both the desktop and mobile menus */
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".user-menu-btn") : null;
      document.querySelectorAll(".user-menu-btn").forEach(function (b) {
        if (b === btn) {
          b.setAttribute("aria-expanded", String(b.getAttribute("aria-expanded") !== "true"));
        } else {
          b.setAttribute("aria-expanded", "false");
        }
      });
      if (e.target.closest && e.target.closest("[data-signout]")) {
        if (window.PB_AUTH && window.PB_AUTH.signOut) window.PB_AUTH.signOut();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        document.querySelectorAll(".user-menu-btn").forEach(function (b) {
          b.setAttribute("aria-expanded", "false");
        });
      }
    });

    window.addEventListener("pb-auth", function (e) { applyAuth(e.detail.user); });

    if (window.PB_AUTH && window.PB_AUTH.ready) {
      applyAuth(window.PB_AUTH.user);
    } else {
      var hint = readHint();
      if (hint) applyAuth(hint);
    }

    /* Firebase must come from an injected module script (a dynamic import()
     * inside this classic script fails silently for the CDN modules). */
    var m = document.createElement("script");
    m.type = "module";
    m.src = prefix + "js/auth-core.js";
    document.head.appendChild(m);
  }

  /* ── 9. Inject into the DOM ──────────────────────────────────── */
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
    attachBrandFade();
    initAuthHeader(prefix);
  }

  /* Run after DOM is ready */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }

})();
