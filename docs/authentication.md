# FASALYTICS — Authentication Architecture (Phase 2)

## Identity model

One **Firebase Auth user (UID)** per farmer, with up to three linked providers:

| Provider | Purpose | Added by |
|----------|---------|----------|
| `password` | Everyday login (any email provider) | `/signup`, `/account/email`, or explicit password creation during recovery |
| `google.com` | Everyday login | Continue with Google, or *Profile → Link Google* |
| `phone` | One-time verified mobile; password recovery | `/verify-phone` (`linkWithPhoneNumber`), or legacy mobile login |

PostgreSQL `farmers.firebase_uid` is the link between the Firebase identity and the farmer profile. Email, phone and verification flags are copied **only from verified ID-token claims** and refreshed on each `GET /api/auth/session`.

## Registration state machine

```text
signed in ─▶ no email? ──▶ /account/email   (legacy mobile-only accounts)
          ─▶ no phone? ──▶ /verify-phone ─▶ /verify-otp   (one-time OTP, linked to same UID)
          ─▶ email not verified? ─▶ /verify-email          (Firebase verification email)
          ─▶ no profile? ─▶ /register ─▶ POST /api/farmers/me ─▶ welcome email (once)
          ─▶ dashboard
```

`getSetupStep()` (`frontend/src/utils/setupSteps.js`) drives `ProtectedRoute`: app routes redirect to the first unmet step; each step route renders only while it is the current step, so steps cannot be skipped. The backend independently rejects profile creation without `phone_number`, `email` and `email_verified` claims.

## Flows

```text
Email login     signInWithEmailAndPassword ───────────────▶ onIdTokenChanged ─▶ GET /api/auth/session
Google login    signInWithPopup (fallback signInWithRedirect) ─▶ same
Mobile login    signInWithPhoneNumber + OTP (legacy accounts) ─▶ same
Phone linking   linkWithPhoneNumber + OTP ─▶ getIdToken(true) (phone_number claim)
Email verify    sendEmailVerification ─▶ user clicks link ─▶ reload() + getIdToken(true)
Google linking  linkWithPopup (signed in) | account-exists-with-different-credential ─▶ password login ─▶ linkWithCredential
Recovery        signInWithPhoneNumber + OTP (proves phone) ─▶ isNewUser? delete : 10-min reset window
                ─▶ reauthenticate(newPassword) succeeds? reject (same password) : updatePassword ─▶ signOut
```

`AuthContext` listens with `onIdTokenChanged`, so linking a provider or refreshing claims updates the identity snapshot; the backend session is reloaded only when identity details change.

## Security rules

- UID, email and phone come only from the verified Firebase ID token; request bodies containing identity fields are rejected (`400`).
- Every query is parameterised and scoped by `firebase_uid`; unique indexes on phone and `lower(email)` prevent duplicate profiles.
- Login errors are identical for unknown email and wrong password; sign-up conflicts use neutral wording; all API endpoints are authenticated (no public account-existence checks).
- Accounts are never merged by matching email alone. Explicit linking requires an authenticated session (or proving the existing password). Firebase's own Gmail/Google trusted-provider linking relies on Google proving mailbox ownership.
- Passwords, OTPs and verification codes are handled by Firebase only — never stored or logged by FASALYTICS.
- Password reuse: only the *current* password can be checked (via re-authentication). Firebase/Identity Platform keeps no password history, so "not any previous password" cannot be enforced without storing password hashes, which this design deliberately avoids.

## Welcome email

`createWelcomeEmailService()` claims a farmer row with one atomic `UPDATE … SET welcome_email_status='sending' … RETURNING`, so concurrent triggers send at most one email. Results are recorded (`sent`, `failed`, `not_configured`) with attempts and the last error; a retry pass runs at startup and every 15 minutes (max 5 attempts). Providers (Resend, SendGrid) are called over HTTPS with an idempotency key; credentials live only in `backend/.env`.

## Frontend structure

| File | Role |
|------|------|
| `src/services/authService.js` | Firebase calls: email/password, Google, phone OTP, linking, password reset, validation, error messages |
| `src/context/AuthContext.jsx` | Identity snapshot, profile status, setup step, pending OTP/Google link, reset proof, logout |
| `src/utils/setupSteps.js` | Ordered registration requirements |
| `src/components/ProtectedRoute.jsx`, `PublicRoute.jsx` | Route guards |
| `src/components/AuthControls.jsx`, `FormField.jsx` | Stitch-styled inputs, buttons, Google button |
| `src/pages/LoginPage.jsx`, `SignupPage.jsx`, `PhoneLoginPage.jsx` | Sign-in / sign-up |
| `src/pages/VerifyPhonePage.jsx`, `VerifyOtpPage.jsx`, `VerifyEmailPage.jsx`, `AddEmailPage.jsx`, `FarmerRegistrationPage.jsx` | Registration steps |
| `src/pages/ForgotPasswordPage.jsx`, `ResetPasswordPage.jsx` | Phone-OTP password recovery |
| `src/pages/ProfilePage.jsx`, `components/AccountMenu.jsx` | Profile, sign-in methods, logout |
