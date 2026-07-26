(function () {
  "use strict";

  var WA_NUMBER = "919787692116";

  function waUrl(message) {
    var text = encodeURIComponent(message || "Hi Prof. Balaji, I'd like to know more about the classes.");
    return "https://wa.me/" + WA_NUMBER + "?text=" + text;
  }

  /* Mobile nav */
  var toggle = document.getElementById("menu-toggle");
  var mobileNav = document.getElementById("nav-mobile");
  if (toggle && mobileNav) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      mobileNav.classList.toggle("open", !open);
      document.body.classList.toggle("nav-open", !open);
    });
    mobileNav.querySelectorAll("a:not([aria-haspopup])").forEach(function (link) {
      link.addEventListener("click", function () {
        toggle.setAttribute("aria-expanded", "false");
        mobileNav.classList.remove("open");
        document.body.classList.remove("nav-open");
      });
    });
  }

  /* Mobile dropdown */
  var mobileDropdownTrigger = document.querySelector(".nav-mobile-dropdown-trigger");
  if (mobileDropdownTrigger) {
    mobileDropdownTrigger.addEventListener("click", function () {
      var expanded = mobileDropdownTrigger.getAttribute("aria-expanded") === "true";
      mobileDropdownTrigger.setAttribute("aria-expanded", String(!expanded));
    });
  }

  /* Desktop dropdown menu */
  var dropdownTrigger = document.querySelector(".nav-dropdown-trigger");
  var dropdownMenu = document.querySelector(".nav-dropdown-menu");
  if (dropdownTrigger) {
    dropdownTrigger.addEventListener("click", function () {
      var expanded = dropdownTrigger.getAttribute("aria-expanded") === "true";
      dropdownTrigger.setAttribute("aria-expanded", String(!expanded));
    });
    document.addEventListener("click", function (e) {
      var dropdown = document.querySelector(".nav-dropdown");
      if (dropdown && !dropdown.contains(e.target)) {
        dropdownTrigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* About read more */
  var aboutBio = document.getElementById("about-bio");
  var aboutToggle = document.getElementById("about-toggle");
  if (aboutBio && aboutToggle) {
    aboutToggle.addEventListener("click", function () {
      var expanded = aboutBio.classList.toggle("expanded");
      aboutToggle.textContent = expanded ? "Read less" : "Read more";
    });
  }

  /* FAQ tabs + accordion */
  var faqTabs = document.querySelectorAll("[data-faq-tab]");
  var faqItems = document.querySelectorAll("[data-faq-cat]");

  function filterFaq(cat) {
    faqItems.forEach(function (item) {
      var match = item.getAttribute("data-faq-cat") === cat;
      item.hidden = !match;
      if (!match) {
        item.classList.remove("open");
        var q = item.querySelector(".faq-q");
        if (q) q.setAttribute("aria-expanded", "false");
      }
    });
  }

  faqTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      faqTabs.forEach(function (t) {
        t.setAttribute("aria-selected", "false");
      });
      tab.setAttribute("aria-selected", "true");
      filterFaq(tab.getAttribute("data-faq-tab"));
    });
  });

  /* Default: Course tab */
  filterFaq("course");

  document.querySelectorAll(".faq-q").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var item = btn.closest(".faq-item");
      if (!item) return;
      var wasOpen = item.classList.contains("open");
      item.classList.toggle("open", !wasOpen);
      btn.setAttribute("aria-expanded", String(!wasOpen));
    });
  });

  /* Blog carousel */
  var track = document.getElementById("blog-track");
  var prevBtn = document.getElementById("blog-prev");
  var nextBtn = document.getElementById("blog-next");

  function cardStep() {
    if (!track) return 320;
    var card = track.querySelector(".article-card");
    if (!card) return 320;
    var style = window.getComputedStyle(track);
    var gap = parseFloat(style.columnGap || style.gap) || 16;
    return card.getBoundingClientRect().width + gap;
  }

  function updateCarouselButtons() {
    if (!track || !prevBtn || !nextBtn) return;
    var max = track.scrollWidth - track.clientWidth - 2;
    prevBtn.disabled = track.scrollLeft <= 2;
    nextBtn.disabled = track.scrollLeft >= max;
  }

  if (track && prevBtn && nextBtn) {
    prevBtn.addEventListener("click", function () {
      track.scrollBy({ left: -cardStep(), behavior: "smooth" });
    });
    nextBtn.addEventListener("click", function () {
      track.scrollBy({ left: cardStep(), behavior: "smooth" });
    });
    track.addEventListener("scroll", updateCarouselButtons, { passive: true });
    window.addEventListener("resize", updateCarouselButtons);
    updateCarouselButtons();
  }

  /* Inquiry form → WhatsApp (no defaults; both required) */
  var board = null;
  var preference = null;
  var boardChips = document.querySelectorAll("[data-board]");
  var prefChips = document.querySelectorAll("[data-pref]");
  var inquiryBtn = document.getElementById("inquiry-submit");

  function syncInquiry() {
    if (!inquiryBtn) return;
    var ready = !!(board && preference);
    inquiryBtn.disabled = !ready;
    inquiryBtn.classList.toggle("btn-disabled", !ready);
  }

  boardChips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      var already = chip.getAttribute("aria-pressed") === "true";
      boardChips.forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
      if (already) {
        board = null;
      } else {
        chip.setAttribute("aria-pressed", "true");
        board = chip.getAttribute("data-board");
      }
      syncInquiry();
    });
  });

  prefChips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      var already = chip.getAttribute("aria-pressed") === "true";
      prefChips.forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
      if (already) {
        preference = null;
      } else {
        chip.setAttribute("aria-pressed", "true");
        preference = chip.getAttribute("data-pref");
      }
      syncInquiry();
    });
  });

  syncInquiry();

  if (inquiryBtn) {
    inquiryBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (!board || !preference) return;
      var msg =
        "Hi Prof. Balaji, I'm interested in joining.\n" +
        "Board: " + board + "\n" +
        "Preference: " + preference + "\n" +
        "Please share batch details and fee information.";
      window.open(waUrl(msg), "_blank", "noopener,noreferrer");
    });
  }

  /* Dynamic WhatsApp links with context */
  document.querySelectorAll("[data-wa]").forEach(function (el) {
    var kind = el.getAttribute("data-wa");
    var messages = {
      demo: "Hi Prof. Balaji, I'd like to book a free demo class.",
      batch: "Hi Prof. Balaji, I'd like to join the 2026 batch.",
      online: "Hi Prof. Balaji, I'd like the online class access link.",
      hybrid: "Hi Prof. Balaji, I'm interested in the Hybrid mode.",
      classroom: "Hi Prof. Balaji, I'd like to visit the classroom in Kanchipuram.",
      fees: "Hi Prof. Balaji, could you please share the fee details?",
      general: "Hi Prof. Balaji, I'd like to know more about the classes."
    };
    var href = waUrl(messages[kind] || messages.general);
    if (el.tagName === "A") el.setAttribute("href", href);
  });

  /* Image fallback: hide broken img, keep placeholder */
  document.querySelectorAll("img[data-fallback]").forEach(function (img) {
    img.addEventListener("error", function () {
      img.style.display = "none";
      var ph = img.parentElement && img.parentElement.querySelector(".ph");
      if (ph) ph.style.display = "grid";
    });
    img.addEventListener("load", function () {
      var ph = img.parentElement && img.parentElement.querySelector(".ph");
      if (ph) ph.style.display = "none";
    });
  });

  /* Mode card expansion on mobile */
  var modeCardToggles = document.querySelectorAll(".mode-card-toggle");
  modeCardToggles.forEach(function (toggle) {
    toggle.addEventListener("click", function () {
      var card = toggle.closest(".mode-card");
      if (card) {
        card.classList.toggle("expanded");
        toggle.setAttribute("aria-expanded", String(card.classList.contains("expanded")));
      }
    });
  });
})();
