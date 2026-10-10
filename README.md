# Prof. Dr. S. Balaji Science Academy

Website and mock test platform for profbalaji.in. Plain HTML, CSS and JavaScript, hosted on GitHub Pages. No build tools and no npm in the deployed site.

## What is in the repository

| Path | Purpose |
|---|---|
| `index.html`, `pages/` | Public site, learning resources, test information page |
| `auth/` | Google sign-in and first-time onboarding |
| `pages/dashboard/` | Student dashboard (practice, mock tests, results) |
| `pages/admin/` | ProfAdmin console (approvals, students, questions, papers, analytics) |
| `js/`, `css/` | Shared scripts and styles |
| `firebase/firestore.rules` | Firestore Security Rules (currently v8). Published by hand in the Firebase console |
| `worker/imagekit-auth.js` | Cloudflare Worker script. Pasted into Cloudflare by hand, not used by the website |
| `CNAME` | Custom domain. Differs between the test repo and the main repo, see below |
| `sitemap.xml` | Public pages only. Sign-in, dashboard and admin pages are left out on purpose |

## Accounts and services

| Service | Used for | Where the secret lives |
|---|---|---|
| Firebase (project `profbalaji-scienceacademy`) | Google sign-in and Firestore database (Spark plan, `asia-south1`) | Web config values are public identifiers and are in the code. Nothing secret is in the repo |
| ImageKit (endpoint `https://ik.imagekit.io/profbalaji/`) | Question images | The private key is held by the owner and stored only as a Cloudflare Worker secret |
| Cloudflare Worker `imagekit-auth` | Signs image uploads and deletes images, for ProfAdmin only | Worker secret `IMAGEKIT_PRIVATE_KEY` |

Never put an ImageKit private key, a Firebase Admin SDK key or a service-account file in GitHub, in chat, or in any page or script.

## Making someone a ProfAdmin

In the Firebase console open Firestore Database, collection `admins`. Add a document whose ID is the person's Gmail address in lowercase, with fields `email` and `name`. Delete the document to remove admin access. The website cannot do this.

## Rotating keys

**ImageKit private key** (do this at once if it is ever exposed):
1. In ImageKit, open Developer options and generate a new private key. Note the new public key if it changed.
2. In Cloudflare, open the Worker `imagekit-auth`, then Settings, then Variables and Secrets. Replace the `IMAGEKIT_PRIVATE_KEY` secret. If the public key changed, update `IMAGEKIT_PUBLIC_KEY` too.
3. Deploy the Worker. Test by adding an image to a question in the admin console.

Nothing in the repo changes when the private key is rotated.

**Worker allowed origins**: edit the `ALLOWED_ORIGINS` variable (comma separated, no spaces). It must list `https://profbalaji.in` and `https://test.profbalaji.in`.

**Firebase web config**: these values are public by design. Access is protected by sign-in, the Security Rules and the Authorized domains list (Authentication, Settings). Keep that list to `profbalaji.in`, `test.profbalaji.in`, your GitHub Pages address and `localhost`.

**Owner account**: `cbsedigest@gmail.com` owns Firebase and Cloudflare and is the first ProfAdmin. Keep 2-Step Verification on and recovery options current. Consider adding a second ProfAdmin Gmail as a backup.

## Publishing the Security Rules

Firebase console, Firestore Database, Rules. Paste the whole of `firebase/firestore.rules` and Publish. Do this whenever a release says the rules changed.

## Test site and live site

- The test repo is served at `test.profbalaji.in`; the main repo is served at `profbalaji.in`.
- Both use the same Firebase project, so data created on the test site also exists on the live site.
- **Never copy `CNAME` between repos.** Each repo keeps its own.
- Everything else in the codebase works unchanged on both domains.

## Backup of Firestore data (Spark plan)

The Spark plan has no one-click Firestore export, so the backup is manual and based on what is cheap to recreate:

1. **Questions (the valuable data).** Keep every Excel file you used with Bulk upload, in a dated folder in two places (for example your computer and Google Drive). Questions typed one at a time in the editor are not in any Excel file; keep your own source copy of those. Images are in ImageKit's Media Library under `questions/`; each question holds its image's address.
2. **Chapters.** Keep a simple list of board, class, subject, chapter number and chapter name. Chapters must exist before a bulk upload can place questions in them.
3. **Papers.** Keep a note of each paper's settings (title, levels, duration, negative marking, rules or question list). Papers are small and quick to recreate.
4. **Students and attempts.** Students are approved by hand and can re-apply. Attempt history cannot be rebuilt. If you need it, press Export CSV in Analytics (question-level only, no student identity) before any large deletion.
5. **Admin list.** Note the Gmail addresses in the `admins` collection.
6. **Rules and code.** The rules file and the whole codebase are in GitHub. Keep the last known-good release as a zip.

If you later move to the Blaze plan, Firestore's managed export can replace steps 1 to 4.

## Launch checklist (moving from the test site to profbalaji.in)

Before upload:
1. All Phase 1 to 9 acceptance checks pass on `test.profbalaji.in`, tested in a private window and on a phone.
2. The latest `firebase/firestore.rules` is published.
3. The Worker is deployed with its four variables set, and `ALLOWED_ORIGINS` lists both domains.
4. Firebase Authorized domains include `profbalaji.in` (and `www.profbalaji.in` if used).
5. `admins/cbsedigest@gmail.com` exists.

Upload:
1. Take a copy (zip) of the current live repo contents for rollback.
2. Upload the new codebase to the main repo **without copying `CNAME`**.
3. Wait for GitHub Pages to finish deploying, then hard-refresh.

After upload, on `profbalaji.in`:
1. Sign in as a new student, finish onboarding, see the Pending Approval message.
2. Sign in as ProfAdmin and approve the test student.
3. As the student: practise a question; start and submit a mock test; check the result.
4. As ProfAdmin: open Analytics and press Update.
5. Confirm the header shows "Mock Tests" and that the sign-in, dashboard and admin pages carry `noindex`.
6. Submit `sitemap.xml` in Google Search Console if you use it.

## Rollback plan

1. **Code:** restore the live repo from the zip taken before upload (leaving `CNAME` as it is) and wait for Pages to redeploy.
2. **Rules:** in the Firebase console, Rules tab, use the rules history to return to the previous published version, or paste the previous `firestore.rules`. If the code is rolled back, roll the rules back to the version that code names (the admin page shows a permission message naming the rules version it expects).
3. **Worker:** Cloudflare lists earlier Worker versions under Deployments; roll back there.
4. **Data:** no release migrates or rewrites existing data, so a code rollback needs no data change.

## Notes for maintainers

- Header and footer are injected by `js/header-footer-loader.js`; each page also carries a static fallback that must stay in step with it.
- Private pages (`auth/`, `pages/dashboard/`, `pages/admin/`) carry `<meta name="robots" content="noindex, nofollow">` and are not in `sitemap.xml`.
- The design system is in `css/tokens.css` and `css/styles.css`. No emoji; inline SVG icons only.
