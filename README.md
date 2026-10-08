# FASALYTICS — AI Market and Risk Intelligence for Agri Supply Chains

> **Phase 1: Project Setup & Architecture · Phase 2: Farmer Authentication & Profiles**  
> AI-powered agricultural decision-support platform helping Indian farmers optimize market timing, reduce risk, and maximize net returns.

---

## 1. Project Overview

**FASALYTICS** is designed to address price volatility, asymmetric market intelligence, and logistical challenges faced by Indian farmers. The complete application empowers farmers to:
- Identify the best mandi to sell produce.
- Forecast agricultural prices for 1–7 days.
- Decide whether to sell immediately or hold stock.
- Compare multiple nearby mandis with transport & spoilage deductions.
- Simulate what-if market scenarios.
- Receive vernacular advice in Marathi, Hindi, and English.

---

## 2. Technology Stack

### Frontend
- **React.js (v19)** with **Vite**
- **Tailwind CSS (v3)** configured with exact Google Stitch theme tokens
- **React Router** for declarative client-side navigation
- **Firebase Authentication** (email/password, Google, phone OTP)
- **Material Symbols Outlined** & Google Fonts (Barlow Condensed, Inter, Noto Sans Devanagari)

### Backend
- **Node.js (v24)** & **Express.js (v4)**
- **PostgreSQL (`pg` driver)** with connection pooling and query error resilience
- **CORS** & **dotenv** configuration
- **Firebase Admin SDK** for ID-token verification; Resend/SendGrid for transactional email
- Centralized error and graceful shutdown handlers

### ML Service
- **Python (3.10+)** & **FastAPI**
- **Uvicorn** ASGI server
- Pydantic data modeling

### Database & Infrastructure
- **PostgreSQL 16**
- **Docker Compose** for optional containerized database management

---

## 3. Architecture

```text
Google Stitch HTML Designs
          │
          ▼
React + Vite Frontend (Port 5173)
          │
          ▼ (HTTP REST)
Node.js + Express Backend (Port 5000)
          │
          ├───► PostgreSQL Database (Port 5432)
          │
          └───► Python FastAPI ML Service (Port 8000)
```

For complete architectural details, see [docs/architecture.md](docs/architecture.md).

---

## 4. Folder Structure

```text
AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-/
├── README.md
├── docker-compose.yml            # PostgreSQL 16 (optional)
├── firebase.json                 # Firebase Auth Emulator config (local development only)
├── docs/
│   ├── architecture.md           # Service architecture
│   └── authentication.md         # Phase 2 authentication design
├── database/
│   ├── schema.sql                # Phase 1 tables
│   ├── seed.sql
│   └── migrations/
│       ├── 002_phase2_farmers.sql
│       └── 003_phase2_email_identity.sql
├── frontend/                     # React + Vite (port 5173)
│   ├── .env.example
│   └── src/
│       ├── App.jsx               # Routes (public, registration steps, protected app)
│       ├── config/firebase.js    # Firebase web SDK initialisation
│       ├── context/AuthContext.jsx
│       ├── components/           # Header, BottomNav, AccountMenu, route guards, form controls
│       ├── pages/                # Stitch screens + Login, Signup, Verify OTP/Phone/Email, Register, Profile, Forgot password
│       ├── services/             # api.js, authService.js, farmerService.js
│       ├── utils/                # setupSteps.js, profileValidation.js
│       └── constants/ · i18n/ · layouts/
├── backend/                      # Node.js + Express (port 5000, or 5001 on Windows)
│   ├── .env.example
│   ├── scripts/migrate.js        # npm run migrate
│   ├── tests/                    # npm test (node:test)
│   └── src/
│       ├── app.js · server.js · db.js
│       ├── config/               # env config, Firebase Admin
│       ├── middleware/           # auth (ID token verification), error handler
│       ├── routes/ · controllers/ · validators/
│       └── services/             # farmer.service.js, email/ (welcome email)
├── ml-service/                   # Python FastAPI (port 8000)
│   ├── .env.example
│   └── main.py
└── stitch_ai_mandi_copilot/      # Original Google Stitch reference designs (unchanged)
```

---

## 5. Prerequisites

| Tool | Version | Needed for |
|------|---------|-----------|
| Node.js + npm | 18+ (tested on Node 24 / npm 11) | Frontend, backend, Firebase Auth Emulator |
| Python | 3.10+ | ML service |
| PostgreSQL | 14+ (local) **or** Docker Desktop | Database |
| Firebase project | Spark plan works for email/Google; real SMS may need Blaze | Authentication |
| Resend or SendGrid account | Optional | Welcome emails |

Commands below are for **Windows PowerShell**, run from the repository root.

---

## 6. Install Dependencies

```powershell
cd frontend; npm install; cd ..
cd backend; npm install; cd ..

cd ml-service
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
deactivate
cd ..
```

---

## 7. Environment Configuration

Copy each template, then edit the copies (they are git-ignored):

```powershell
Copy-Item frontend\.env.example frontend\.env
Copy-Item backend\.env.example backend\.env
Copy-Item ml-service\.env.example ml-service\.env
```

| File | Variable | Required | Description |
|------|----------|----------|-------------|
| `backend/.env` | `PORT` | yes | Express port (5000; falls back to 5001 if Windows reserves 5000) |
| | `NODE_ENV` | no | `development` adds stack traces to 5xx responses |
| | `FRONTEND_URL` | yes | CORS origin and dashboard link in welcome emails |
| | `ML_SERVICE_URL` | yes | FastAPI base URL |
| | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | yes | PostgreSQL connection (or `DATABASE_URL`) |
| | `FIREBASE_PROJECT_ID` | yes | Same project as the frontend; used to verify ID tokens |
| | `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` | no | Service account (not needed for token verification) |
| | `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | no | Welcome email (`resend` or `sendgrid`) |
| | `FIREBASE_AUTH_EMULATOR_HOST` | dev only | Trust Auth Emulator tokens |
| `frontend/.env` | `VITE_API_URL` | yes | Backend URL (`http://localhost:5001` if the backend fell back) |
| | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | yes | Firebase web app config |
| | `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID` | no | Firebase web app config |
| | `VITE_FIREBASE_AUTH_EMULATOR_URL` | dev only | Use the Auth Emulator |
| `ml-service/.env` | `HOST`, `PORT` | no | Used when starting with `python main.py` |

> `frontend/.env` is bundled into the browser — never put service-account keys or email API keys there.

---

## 8. Firebase Setup (one time)

In the [Firebase Console](https://console.firebase.google.com):

1. **Create or select a project** and note its *Project ID* (Project settings → General).
2. **Register a Web app** (Project settings → General → Your apps → Web). Copy `apiKey`, `authDomain`, `projectId` and `appId` into `frontend/.env`, and put the same project ID in `backend/.env` → `FIREBASE_PROJECT_ID`.
3. **Authentication → Sign-in method** — enable:
   - **Email/Password**, and inside it **Email link (passwordless sign-in)** (needed when an existing mobile-only account adds an email — see the note below).
   - **Google** — set a project support email.
   - **Phone** — optionally add *Phone numbers for testing* (e.g. `+91 98765 43210` / `123456`) for development; remove them before launch.
4. **Authentication → Settings**:
   - *Authorized domains*: keep `localhost`; add your production domain. Open the app at `http://localhost:5173` (not `127.0.0.1`).
   - *User account linking*: **Link accounts that use the same email**.
   - *User actions → Email enumeration protection*: recommended **on**.
   - *SMS region policy*: allow **India (+91)**. Real SMS delivery may require the **Blaze** plan.
   - *Password policy* (optional): at least 8 characters with upper/lowercase and a number, matching the app.
5. **Authentication → Templates → Email address verification**: set the sender name to *FASALYTICS*.

> **Why "Email link" must be enabled:** with email enumeration protection on, Firebase refuses to attach an *unverified* email to an existing account (`auth/operation-not-allowed` — "Please verify the new email before changing email"). The app then emails a one-time link that proves ownership and links the email to the same account. If *Email link* is disabled, the Add Email screen says so and names the project and setting.

**Optional — develop without a Firebase project** using the Auth Emulator (no real SMS or email; OTPs and email links are exposed by the emulator):

```powershell
npx firebase-tools emulators:start --only auth --project demo-fasalytics
```

Then set `VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099` and `VITE_FIREBASE_PROJECT_ID=demo-fasalytics` (with a dummy API key and app ID) in `frontend/.env`, and `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and `FIREBASE_PROJECT_ID=demo-fasalytics` in `backend/.env`. OTP codes appear at `http://127.0.0.1:9099/emulator/v1/projects/demo-fasalytics/verificationCodes`, and email links at `.../oobCodes`. Never use these settings in production.

---

## 9. Email Provider Setup (optional — welcome email)

1. Create an account with [Resend](https://resend.com) (or SendGrid).
2. Verify your sending domain by adding the DNS records the provider shows.
3. Create an API key.
4. In `backend/.env`:
   ```env
   EMAIL_PROVIDER=resend
   EMAIL_API_KEY=re_xxxxxxxxxxxxxxxx
   EMAIL_FROM=FASALYTICS <no-reply@your-verified-domain.in>
   ```
5. Restart the backend — the startup log shows `✉️  Welcome email: resend`.

Without a provider, registration still completes: the welcome email is recorded as `not_configured` and sent automatically once a provider is configured (a retry pass runs at startup and every 15 minutes).

---

## 10. Database Setup

### Option A — Docker Compose

```powershell
docker compose --env-file backend/.env up -d postgres
```

`--env-file` makes Docker use the same `DB_PORT` and credentials as the backend. A **fresh** volume runs `schema.sql`, `seed.sql` and migration `002` automatically; run the migrations below anyway (already-applied files are skipped).

### Option B — Local PostgreSQL

```powershell
psql -U postgres -c "CREATE DATABASE fasalytics;"
psql -U postgres -d fasalytics -f database/schema.sql
psql -U postgres -d fasalytics -f database/seed.sql
```

### Apply migrations (required for Phase 2)

```powershell
cd backend
npm run migrate
cd ..
```

This applies `database/migrations/*.sql` in order and records them in `schema_migrations`. Re-running is safe and never drops existing data.

---

## 11. Run the Application

Use three terminals:

```powershell
# 1. Backend (auto-restarts on code or backend/.env changes)
cd backend; npm run dev
```

```powershell
# 2. ML service
cd ml-service; .\venv\Scripts\Activate.ps1; uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

```powershell
# 3. Frontend
cd frontend; npm run dev
```

Check the backend startup log:

```text
📡 Port: 5001                                  ← use this port in VITE_API_URL
🔐 Firebase Auth: ready (project "your-project-id")
✉️  Welcome email: resend                      ← or NOT CONFIGURED
```

Open **http://localhost:5173** — signed-out visitors are redirected to `/login`.

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:5000 (or 5001) |
| ML service / Swagger | http://localhost:8000 · http://localhost:8000/docs |

---

## 12. Verify the Setup

```powershell
Invoke-RestMethod http://localhost:5001/api/health            # backend
Invoke-RestMethod http://localhost:5001/api/health/database   # PostgreSQL
Invoke-RestMethod http://localhost:5001/api/health/ml         # ML service via backend
Invoke-RestMethod http://localhost:8000/health                # ML service direct
```

Use port 5000 if your backend runs there. Then in the browser:

1. `/signup` — create an account (name, email, password, mobile).
2. Verify the mobile OTP, open the link in the verification email, then press **I have verified my email**.
3. Complete the farmer profile — you land on the dashboard.
4. Log out, then log in with email and password (no OTP is sent).

Automated checks:

```powershell
cd backend
npm test          # API, registration rules and welcome-email tests against PostgreSQL
cd ..\frontend
npm run lint
npm run build
```

To include the Firebase identity tests, start the Auth Emulator and run `npm test` in `backend` after setting `$env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"` and `$env:FIREBASE_PROJECT_ID="demo-fasalytics"`.

---

## 13. Troubleshooting

| Symptom | Fix |
|---------|-----|
| PostgreSQL connection refused | Check `DB_HOST`/`DB_PORT` in `backend/.env` and that PostgreSQL or Docker is running (`Test-NetConnection localhost -Port 5432`). |
| `DATABASE_NOT_MIGRATED` | `cd backend; npm run migrate`. |
| Backend reports port 5000 unavailable | Windows reserves it; the backend uses 5001 — set `VITE_API_URL=http://localhost:5001`. |
| "Authentication service is not configured on the server" | `FIREBASE_PROJECT_ID` is missing in `backend/.env`; add it and restart the backend. |
| "Firebase is not configured. Missing: VITE_FIREBASE_…" | Fill in `frontend/.env` and restart `npm run dev`. |
| Every API call returns `INVALID_TOKEN` | Frontend and backend use different Firebase projects, or only one of them uses the emulator. |
| `auth/operation-not-allowed` — "Please verify the new email…" | Expected with email enumeration protection; the app switches to the email-link flow. Make sure **Email link (passwordless sign-in)** is enabled. |
| "This sign-in method is disabled in Firebase project …" | Enable the named provider in Authentication → Sign-in method of **that** project. |
| "This website is not authorised for login / email links" | Add the domain under Authentication → Settings → Authorized domains; use `localhost`. |
| SMS not received / `auth/billing-not-enabled` | Allow India in the SMS region policy; the Blaze plan may be required; use test phone numbers in development. |
| "Security check failed" (reCAPTCHA) | Disable ad blockers for the site and reload. |
| Google popup blocked | Allow popups. The redirect fallback needs the auth domain to be same-site with the app (see §15.8). |
| Welcome email not sent | Check the backend log; set `EMAIL_PROVIDER`, `EMAIL_API_KEY` and `EMAIL_FROM` with a verified domain. |
| `Activate.ps1` cannot be loaded | `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`. |

---

## 14. Phase 1 Completion Checklist

- [x] Inspect existing Google Stitch HTML/CSS reference designs.
- [x] Preserve original visual styling, fonts, and Tailwind color tokens without modifications.
- [x] Convert Stitch HTML to modular React components (Home, Splash/Onboarding, Ask AI, Recommendation Result).
- [x] Configure React Router with functional navigation between all pages.
- [x] Set up Express backend with modular architecture, CORS, and error handling.
- [x] Implement `/api/health`, `/api/health/database` (`SELECT 1`), and `/api/health/ml`.
- [x] Create minimal PostgreSQL schema and seed files (`database/schema.sql`, `database/seed.sql`).
- [x] Create FastAPI ML service with `/health` and modular directories.
- [x] Implement frontend API service (`frontend/src/services/api.js`) and live connection indicator.
- [x] Create Docker Compose configuration for PostgreSQL.
- [x] Create environment templates (`.env.example`) and comprehensive `.gitignore`.
- [x] Write architectural documentation (`docs/architecture.md`) and run instructions.
- [x] Verify frontend production build (`npm run build`).

---

## 15. Phase 2 — Farmer Authentication & Profile Management

Phase 2 adds Firebase Authentication (email/password, Google and one-time phone OTP verification), farmer registration, PostgreSQL farmer profiles, protected routes, password recovery, a welcome email and a dashboard personalised with the farmer's profile. Mandi data ingestion, forecasting, price analytics and AI recommendations move to later phases; dashboard market cards are labelled **demo content** until then.

Architecture details: [docs/authentication.md](docs/authentication.md).

### 15.1 What's included

| Area | Implementation |
|------|----------------|
| Login | `/login` — email + password, Continue with Google, Forgot password, Create account; `/login/phone` — mobile OTP for older mobile-only accounts |
| Registration | `/signup` → one-time phone OTP (`/verify-phone`, `/verify-otp`) → email verification (`/verify-email`) → farmer profile (`/register`) |
| Older accounts | `/account/email` — mobile-only accounts add an email login (same Firebase UID and profile) |
| Recovery | `/forgot-password` — phone OTP proves ownership, then a new password (must differ from the current one) |
| Profile | `/profile` — view/edit details, sign-in methods (link Google), log out; account menu in the header |
| Dashboard | Greeting in the farmer's language, name, district/state, primary crop & quantity; market cards labelled demo |
| Language | Header EN / हिं / मराठी pills and onboarding cards save `preferred_language` (en/hi/mr) |
| Backend | Firebase Admin token verification, `/api/auth/session`, `/api/farmers/me`, idempotent welcome email |
| Database | `farmers` table — migrations `002_phase2_farmers.sql` and `003_phase2_email_identity.sql` |

### 15.2 Setup

Setup is covered in the main guide: environment variables (§7), Firebase Console settings (§8), email provider (§9), database and migrations (§10), running the app (§11) and verification (§12).

### 15.3 Authentication flow

1. The farmer signs in with email/password or Google (no OTP), or with mobile OTP for older mobile-only accounts.
2. The app calls `GET /api/auth/session` with `Authorization: Bearer <Firebase ID token>`.
3. Express verifies the token with Firebase Admin and looks up `farmers.firebase_uid`, mirroring verified email/phone claims onto the profile.
4. Until registration is complete, the farmer is sent to the first unmet step: add email login → verify phone (once) → verify email → farmer profile.
5. With a completed profile the farmer reaches the dashboard (or the page originally requested).
6. A rejected token is refreshed once automatically; if the backend still rejects it the farmer is logged out with a message.

### 15.4 Farmer profile API

All endpoints require `Authorization: Bearer <firebase-id-token>`. The UID and phone number always come from the verified token, never from the request body.

| Method | Path | Description | Responses |
|--------|------|-------------|-----------|
| GET | `/api/auth/session` | Validates session; returns `{ authenticated, phoneNumber, profileComplete, farmer }` | 200 |
| GET | `/api/farmers/me` | Current farmer's profile | 200 / 404 `PROFILE_NOT_FOUND` |
| POST | `/api/farmers/me` | Create profile | 201 / 409 `PROFILE_EXISTS` / 409 `PHONE_ALREADY_REGISTERED` |
| PUT | `/api/farmers/me` | Partial update of editable fields | 200 / 404 |

Body (POST requires `fullName`, `state`, `district`, `primaryCrop`, `cropQuantity`; PUT accepts any subset):

```json
{
  "fullName": "Ramesh Patil",
  "state": "Maharashtra",
  "district": "Nashik",
  "village": "Lasalgaon",
  "primaryCrop": "Onion",
  "cropQuantity": 25,
  "quantityUnit": "quintal",
  "preferredLanguage": "mr"
}
```

`quantityUnit`: `kg` | `quintal` (default `quintal`) · `preferredLanguage`: `en` | `hi` | `mr` (default `en`) · `state` must be an Indian state/UT. Sending `phoneNumber`, `firebaseUid`, `id` or unknown fields returns `400 VALIDATION_ERROR`.

Error shape: `{ "status": "error", "code": "VALIDATION_ERROR", "message": "...", "details": { "field": "reason" } }`

| Status | Codes |
|--------|-------|
| 400 | `VALIDATION_ERROR`, `PHONE_NOT_VERIFIED` |
| 401 | `AUTH_REQUIRED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `SESSION_REVOKED` |
| 404 | `PROFILE_NOT_FOUND` |
| 409 | `PROFILE_EXISTS`, `PHONE_ALREADY_REGISTERED` |
| 503 | `AUTH_NOT_CONFIGURED`, `AUTH_UNAVAILABLE`, `DATABASE_UNAVAILABLE`, `DATABASE_NOT_MIGRATED` |

### 15.5 Tests

```bash
cd backend
npm test
```

| Suite | Covers | Needs |
|-------|--------|-------|
| `tests/farmers.api.test.js` | Auth middleware, profile create/read/update, registration requirements (verified phone + email), validation, isolation between farmers, Phase 1 health endpoints | PostgreSQL with migrations applied |
| `tests/welcome-email.test.js` | Email template, send-once under concurrency, failure + retry, `not_configured`, retry limit, provider adapters (mocked — no real email) | PostgreSQL |
| `tests/firebase-emulator.test.js` | Real Firebase Admin verification of emulator tokens: email signup, phone linking, email verification, Google sign-in/linking, password login without SMS, phone recovery | Auth Emulator + `FIREBASE_AUTH_EMULATOR_HOST`, `FIREBASE_PROJECT_ID=demo-fasalytics` (skipped otherwise) |

### 15.6 Troubleshooting

See §13. Additional note: the Verify OTP page returns to the previous step after a browser refresh — the Firebase OTP confirmation lives in memory, so request a new OTP.

### 15.7 Phase 2 checklist

- [x] Firebase Phone OTP login, verify, resend cooldown, logout, persistent sessions
- [x] Firebase Admin ID-token verification middleware
- [x] `farmers` table migration with constraints and indexes
- [x] `GET/POST/PUT /api/farmers/me`, `GET /api/auth/session`
- [x] Registration, profile view/edit, protected/public routes
- [x] Dashboard shows the authenticated farmer's details; market cards labelled demo
- [x] Language preference saved to PostgreSQL and restored on login
- [ ] Real SMS OTP verified against a live Firebase project (needs your Firebase config)
### 15.8 Authentication enhancement — email, Google, one-time phone verification

**Sign-in methods**

| Method | Where | OTP sent? |
|--------|-------|-----------|
| Email + password (any provider: Gmail, Yahoo, Outlook, custom domains) | `/login` | No |
| Continue with Google (popup; redirect fallback when popups are blocked) | `/login`, `/signup` | No |
| Mobile OTP login (for accounts created with a mobile number only) | `/login/phone` | Yes |

**Registration steps** — every Firebase account must complete these in order; the route guard (`frontend/src/utils/setupSteps.js`) and the backend (`POST /api/farmers/me`) enforce the same rules from the verified ID token:

1. Account: `/signup` (name, email, password, confirm password, mobile) — or Google.
2. `/account/email` — only for older mobile-only accounts: add email + password (or link Google). If Firebase requires the email to be verified first, a one-time email link completes the step on the same account.
3. `/verify-phone` → `/verify-otp` — **one-time** OTP that *links* the phone to the same Firebase account (`linkWithPhoneNumber`). A number already linked to another account is rejected.
4. `/verify-email` — Firebase verification email (skipped for Google, whose emails are already verified).
5. `/register` — farmer profile → PostgreSQL. A welcome email is then sent once.

**Account linking (no silent merges)**
- Signed-in farmers can link Google from *Profile → Sign-in Methods* (`linkWithPopup`).
- If Google sign-in reports `auth/account-exists-with-different-credential`, the app keeps the Google credential and links it only after the farmer logs in with the existing password.
- Firebase behaviour to be aware of: for `@gmail.com` addresses Google is the authoritative identity provider, so Firebase itself links a Google sign-in to an existing account with the same Gmail address (keeping the password only if that email was verified). This relies on Google proving mailbox ownership, not on an email match alone.

**Forgot password** (`/forgot-password`)
1. Farmer enters the registered mobile; Firebase phone OTP proves control. Phone sign-in returns the account the number is linked to; an unregistered number is rejected and the account Firebase created for it is deleted.
2. `/forgot-password/new` (valid 10 minutes after OTP): new password must differ from the current one (checked by a re-authentication attempt — Firebase exposes no password history, so older passwords cannot be compared), then `updatePassword`. The farmer is signed out and logs in with the new password.
3. Google-only accounts are never given a password automatically; they may keep using Google or explicitly choose *Create a password*.

**Welcome email** (`backend/src/services/email/`)
- Sent after profile completion with verified email and phone; distinct from Firebase's verification email.
- Providers: Resend or SendGrid over HTTPS (`EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` in `backend/.env`; keys never reach the browser).
- Idempotent: an atomic database claim (`welcome_email_status`) guarantees one email per farmer even with concurrent requests or multiple servers; providers also receive an idempotency key.
- Failure never undoes registration: status becomes `failed` (retried every 15 minutes, max 5 attempts) or `not_configured` (retried once a provider is configured).

**Migration** — `npm run migrate` applies `database/migrations/003_phase2_email_identity.sql` (adds `email`, `email_verified`, `phone_verified`, `registration_completed_at`, `welcome_email_*`; existing phone-registered profiles are backfilled with `welcome_email_status = 'skipped'`).

**Firebase Console settings** — see §8. In particular, enable **Email link (passwordless sign-in)** under Email/Password: projects with email enumeration protection refuse to attach an unverified email to an existing account, and the app then verifies the address with a one-time email link before linking it to the same account.

**Google redirect fallback** — browsers that partition third-party storage break `signInWithRedirect` unless the auth domain is same-site with the app. In production, host on Firebase Hosting and set `VITE_FIREBASE_AUTH_DOMAIN` to your app's domain, or proxy `/__/auth/*` to `<project>.firebaseapp.com`. The popup flow (default) is unaffected.

**Email provider setup** — see §9.

**New/changed API behaviour**
- `POST /api/farmers/me` now also requires an email and `email_verified` in the token: `400 EMAIL_REQUIRED`, `400 EMAIL_NOT_VERIFIED`, `409 EMAIL_ALREADY_REGISTERED`.
- `GET /api/auth/session` returns `account { email, emailVerified, phoneNumber, signInProvider }` and mirrors verified token claims onto the profile.
- Farmer objects include `email`, `emailVerified`, `phoneVerified`, `registrationCompletedAt`, `welcomeEmailStatus`.

- [x] Email/password registration with validation, verification email, one-time phone OTP linking
- [x] Continue with Google (new + returning), secure Google linking, no duplicate profiles
- [x] Phone-OTP password recovery with same-password rejection; explicit password creation for Google-only accounts
- [x] Idempotent welcome email with delivery tracking and retries (provider mocked in tests)
- [ ] Real delivery via a configured email provider (needs your provider account + verified domain)
- [ ] Live Firebase project test of Email/Password + Google providers (needs the providers enabled in your console)
