/*
 * firebase-auth-header.js
 * ────────────────────────────────────────────────────────────────────
 * This is NOT a standalone script to include via <script src>.
 * It is a REFERENCE / COPY-PASTE snippet.
 *
 * Paste the <script type="module"> block below into every HTML page
 * that uses the shared header (i.e. every page except auth/index.html,
 * which handles its own Firebase logic inline).
 *
 * Place it AFTER the <script src="js/header-footer-loader.js"> tag
 * and AFTER the <script src="js/main.js" defer> tag.
 *
 * IMPORTANT: Replace the firebaseConfig values with your real values.
 * They are identical to the ones in auth/index.html.
 * ────────────────────────────────────────────────────────────────────
 */

/*
PASTE THIS BLOCK INTO EACH PAGE (before </body>):

<script type="module">
  import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  import { getAuth, onAuthStateChanged, signOut }
                             from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

  const firebaseConfig = {
    apiKey:            "YOUR_API_KEY",
    authDomain:        "YOUR_AUTH_DOMAIN",
    projectId:         "YOUR_PROJECT_ID",
    storageBucket:     "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId:             "YOUR_APP_ID"
  };

  const app  = initializeApp(firebaseConfig);
  const auth = getAuth(app);

  // Wait for header-footer-loader.js to finish injecting the header,
  // then watch auth state and update the button.
  function updateAuthButton(user) {
    var btn       = document.getElementById("header-auth-btn");
    var btnMobile = document.getElementById("header-auth-btn-mobile");

    if (!btn && !btnMobile) return; // auth page — no button rendered

    if (user) {
      // Signed in — show Sign Out
      if (btn) {
        btn.textContent = "Sign Out";
        btn.removeAttribute("href");
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          signOut(auth).then(function () { window.location.reload(); });
        });
      }
      if (btnMobile) {
        btnMobile.textContent = "Sign Out";
        btnMobile.removeAttribute("href");
        btnMobile.addEventListener("click", function (e) {
          e.preventDefault();
          signOut(auth).then(function () { window.location.reload(); });
        });
      }
    } else {
      // Not signed in — button already points to auth/index.html from loader
      // No changes needed; button reads "Sign Up" by default.
    }
  }

  onAuthStateChanged(auth, updateAuthButton);
</script>
*/
