# Frontend styling and registration repair — 2026-10-09

Work performed only in the canonical D: project. Landing-page integration was postponed at the user's request: the locally inspected `team/landing-page` commit `072d3f3` contained only `README.md`, and the user confirmed the same after fetching manually.

## Root causes and repairs

### Unstyled registration screen

`main.jsx` already imported `index.css`, which contained the Tailwind directives. The Stitch components and theme tokens were present. The failure was dependent on the directory used to launch Vite:

- PostCSS used `tailwindcss: {}`, so Tailwind searched for its configuration relative to the working directory.
- Tailwind's content globs also used working-directory-relative paths.
- Launching/building with `frontend` as the Vite root from the repository directory missed the frontend theme and content. Before the repair, this produced the warning that Tailwind content was missing, only **4,334 bytes of CSS**, and no `#00260d` Stitch color or `.gap-space-md` spacing utility.
- Running from the frontend directory succeeded, explaining why an ordinary production-build check alone did not reveal the problem.

PostCSS now resolves `tailwind.config.js` relative to its own file; Tailwind scans content relative to that configuration; Vite explicitly anchors its root to the frontend directory. `npm run check:styles` builds in separate processes from both directories, checks representative Stitch utilities, and verifies identical CSS hashes. Both pass.

The existing colors, typography direction, cards, icons, routes and component structure remain. Additional layout repairs constrain authentication forms to 576 px on desktop, constrain app/navigation content, stack district/village inputs on narrow screens, provide visible input borders and font fallbacks, and prevent the narrow header from overflowing. The HTML now references the existing FASALYTICS favicon, loads Material Symbols once, and permits browser zoom.

### Blank page after Save & Continue

`validateProfile()` returns a field-error map: `{}` when valid, or `{ fieldName: message }` when invalid. `FarmerProfileForm` incorrectly destructured its result as `{ valid, errors }`.

For either valid or invalid input, `valid` was undefined, so the form called `setErrors(undefined)` and returned. The following render tried to access `errors.fullName` and threw. This happens **before** `registerProfile()` or the backend save request; it is not a missing dashboard route or a failed redirect.

The form now stores the actual error map, checks `Object.keys(validationErrors).length`, and submits only when there are no validation errors. It also prevents repeat submission while saving and exposes the busy state. Server/network errors continue to appear on the form with the entered values retained.

The existing flow is preserved: Firebase authentication and required verification steps → backend session lookup → profile form only if missing → authenticated profile POST → apply returned profile → existing `/` dashboard. No authentication bypass or replacement redirect was added.

## Files changed by this task

| File | Change |
| --- | --- |
| `frontend/postcss.config.js` | Explicit theme-config path |
| `frontend/tailwind.config.js` | Config-relative content scanning and font fallbacks |
| `frontend/vite.config.js` | Explicit frontend root |
| `frontend/src/components/FarmerProfileForm.jsx` | Fix validation return contract, pending submission guard, responsive field grid |
| `frontend/src/components/FormField.jsx` | Visible field borders and flexible input sizing |
| `frontend/src/layouts/MainLayout.jsx` | Centered, bounded authentication/application content |
| `frontend/src/components/Header.jsx` | Responsive header spacing; service badge hidden on narrow screens |
| `frontend/src/components/BottomNav.jsx` | Bounded desktop navigation width |
| `frontend/index.html` | Existing favicon, one Material Symbols stylesheet, accessible viewport |
| `frontend/package.json`, `frontend/package-lock.json` | Test dependencies and test/style-check scripts |
| `frontend/test/auth-flow.test.jsx` | Form, provider, API-client and route regression tests |
| `frontend/test/profile-contract.test.js` | Multilingual frontend/backend payload contract and backend auth middleware tests |
| `frontend/scripts/check-styles.mjs` | CSS regression check from both launch directories |
| This report | Findings, verification and manual checklist |

Concurrent teammate changes in the backend, database, `HomePage.jsx`, `MandisPage.jsx`, `services/api.js`, and the pipeline recovery report are not changes made by this task. They were not overwritten. No Git write operations, backend configuration edits, migrations, data imports or farmer-record writes were performed.

## Verification

Commands below run from `frontend` unless stated otherwise.

| Check | Result |
| --- | --- |
| `npm run build` | PASS; CSS 25.30 kB. Existing large-JavaScript-chunk warning remains. |
| `npm test -- --maxWorkers=1` | PASS: 21 tests across 2 files |
| `npm run check:styles` | PASS: identical Stitch CSS from frontend and repository working directories |
| `npm run check:i18n` | PASS: 263 used keys present in English, Hindi and Marathi |
| `npm run lint` | Exit 0; 16 existing warnings: 15 duplicate translation keys and one `AskAiPage` effect warning |
| `node --check src/controllers/farmer.controller.js` from `backend` | PASS |
| `git diff --check` from repository | PASS |

There was no existing frontend test script/suite. The new suite exercises invalid registration without a crash, successful registration in each language, the full simulated new-user login/profile/dashboard flow, failed-save errors and retry, offline save failure, returning-user login, dashboard remount/session restoration, protected profile deep links, completed-profile redirection, session lookup errors/retry, language switching and verification guards. Backend contract tests check multilingual payload acceptance and missing/invalid/expired/revoked token rejection with the existing injectable verifier. All network/auth fixtures exist only in tests; application authentication is unchanged.

Browser checks used the actual Vite app on a temporary localhost server:

- First visit to `/` reached `/login`, as expected while landing integration is postponed.
- Login layout visually checked at 390×844, 320×740 and 1440×1000. Narrow Marathi and desktop English layouts had no horizontal overflow; desktop form content was bounded to 576 px.
- English, Hindi and Marathi header switching rendered translated login content.
- Opening `/profile` while signed out redirected to login; reloading rendered normally.
- No browser console errors were reported in these checks. The backend service indicator was offline in the test browser.

Live Firebase login/OTP/email verification and PostgreSQL persistence were **not** exercised. The existing backend database/API suites were not run because they insert/delete database records; no emulator was started. Registration/dashboard component behavior is verified with isolated fixtures, not a live farmer account. npm also reported 11 dependency audit findings during test-dependency installation; no broad dependency upgrade was attempted.

## Manual live verification still required

Use an explicitly designated non-production Firebase account and test backend/database; do not edit real farmer records.

1. Restart the frontend with `npm run dev` from `frontend`, then hard-refresh to discard any old CSS. Verify the green Stitch theme, icon glyphs, spacing and form borders.
2. Log in with a new test account, complete the required phone/email verification, and reach `/register`. Submit incomplete fields: errors should show without a blank page or profile POST.
3. Enter valid details and Save & Continue. Confirm one successful `POST /api/farmers/me`, a returned farmer profile, and the dashboard at `/`.
4. Refresh `/` and `/profile`. Sign out and sign back in with the same test account. Confirm its backend session reports a completed profile and registration is not repeated.
5. On a separate new test profile, block its save request in browser DevTools to simulate failure. Confirm an error and retained form values; restore the request and retry.
6. Switch EN/HI/MR on the registration and dashboard screens. Check profile controls, buttons, navigation and scrolling at 320/390 px and a desktop width.

Shravani's actual landing-page source is the remaining dependency for the public landing-page work.

## Follow-up: profile connection error in the preview

The subsequent screenshot showed the styled profile-load error screen. Both frontend and backend configuration point to API port 5001, and the backend was reachable. A CORS mismatch was reproduced for the earlier verification preview: `http://127.0.0.1:5175` received no `Access-Control-Allow-Origin`, while the configured frontend port 5173 was allowed. This prevents browser API requests even though Firebase login can succeed separately. The initial signed-out visual checks did not validate an authenticated API connection.

`frontend/vite.config.js` now sets both development and production-preview servers to port 5173 with `strictPort: true`. A busy port produces an explicit startup error instead of silently choosing a port outside the backend CORS policy. No backend CORS rules or authentication checks were broadened.

Verification after the fix:

- Started the canonical frontend at `http://127.0.0.1:5173`; the browser header shows **API LIVE**.
- Session OPTIONS preflight from that exact origin: HTTP 204, matching allowed origin, authorization header permitted.
- Session GET without credentials: HTTP 401 `AUTH_REQUIRED`, confirming authentication remains enforced without accessing farmer records.
- Production build passed; all 21 tests passed again.

The frontend was left running at the corrected address for the user. Sign in using the same Firebase account there; login storage is scoped to the browser origin, so a login on port 5175 need not carry over to port 5173. Live profile persistence remains a test-account verification step.
