# Local Setup Notes — this machine

Untracked working notes for the local development environment created on
2026-10-09. The repository's own `README.md` remains the source of truth for the
project; this file records only the machine-specific deviations and the steps
needed to start the stack again.

---

## 1. Services and ports (running)

| Service | URL | Notes |
|---------|-----|-------|
| Frontend (Vite) | http://localhost:5173 | `frontend/` |
| Backend (Express) | http://localhost:5001 | `backend/`; `backend/.env` sets `PORT=5001` |
| ML service (FastAPI) | http://localhost:8000 | `ml-service/` |
| PostgreSQL 18 | `localhost:5433` | Windows service `postgresql-x64-18` |

Verified working: `/api/health`, `/api/health/database`, `/api/health/ml`,
`/api/mandi/*`, `/api/forecast/:commodity/:mandi` (Phase 4) and frontend HTTP 200.
`frontend/.env` has `VITE_API_URL=http://localhost:5001` to match.

---

## 2. Machine-specific deviations from the README

### 2.1 PostgreSQL runs on port **5433**, not 5432

Port 5432 cannot be bound on this host even though `netstat -ano` and
`Get-NetTCPConnection` report no listener and it is absent from the Windows
excluded-port ranges (`netsh int ipv4 show excludedportrange protocol=tcp`).
PostgreSQL fails with:

```
could not bind IPv4 address "0.0.0.0": Only one usage of each socket address
(protocol/network address/port) is normally permitted.
FATAL: could not create any TCP/IP sockets
```

PostgreSQL is therefore configured with `port = 5433` in
`C:\Program Files\PostgreSQL\18\data\postgresql.conf`, and `backend/.env` has
`DB_PORT=5433`. The README's 5432 examples apply to a normal machine.

### 2.2 The PostgreSQL service runs as `LocalSystem`

`winget` registered the service under `NT AUTHORITY\NetworkService`, which cannot
write to the data directory in `C:\Program Files\PostgreSQL\18\data`, so the
service failed at startup with `Timed out waiting for server startup`. The
service account was changed to `LocalSystem`:

```powershell
sc.exe config postgresql-x64-18 obj= LocalSystem
Start-Service postgresql-x64-18        # requires an elevated shell
```

### 2.3 Superseded note on port 5000

The backend log line *"Port 5000 is unavailable (Windows EACCES exclusion)"* was
observed while leftover processes from a different checkout still held port 5000.
Once those were stopped, the backend bound 5000 normally and no OS exclusion
exists for it. The backend currently runs on **5000**, matching `VITE_API_URL`.
The README's automatic 5001 fallback remains a valid safety net.

---

## 3. What was installed

- **PostgreSQL 18.6** — `winget install PostgreSQL.PostgreSQL.18` (server,
  pgAdmin, command-line tools). Superuser password: `postgres`.
  `psql` is at `C:\Program Files\PostgreSQL\18\bin\psql.exe` and is **not on
  PATH**.
- **Frontend** — `npm install` in `frontend/` (`node_modules/`).
- **Backend** — `npm install` in `backend/` (`node_modules/`).
- **ML service** — virtualenv at `ml-service/venv/` with `fastapi`, `uvicorn`,
  `pydantic`, `python-dotenv`.
- **Database** — `fasalytics` created and all four migrations applied
  (`002`…`005`). Ten tables present, including `farmers`, `mandis`,
  `commodities`, `mandi_prices`.

`.env` files were copied from the `.env.example` templates and are git-ignored
(`.gitignore` line 11, `*.env`).

---

## 4. Starting the stack

```powershell
# PostgreSQL (already Automatic; start manually only if stopped)
Start-Service postgresql-x64-18          # elevated shell required

# Backend  ->  http://localhost:5000
cd "E:\AA Kushal\AAA-Coding\Hackathon\Syrus 7.0 2\backend"; npm run dev

# ML service -> http://localhost:8000
cd "E:\AA Kushal\AAA-Coding\Hackathon\Syrus 7.0 2\ml-service"
.\venv\Scripts\Activate.ps1
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Frontend -> http://localhost:5173
cd "E:\AA Kushal\AAA-Coding\Hackathon\Syrus 7.0 2\frontend"; npm run dev
```

### Health checks

> The backend listens on **5001** here because `backend/.env` sets `PORT=5001`
> (the application's own port; unrelated to the Phase 4 work).

```powershell
Invoke-RestMethod http://localhost:5001/api/health
Invoke-RestMethod http://localhost:5001/api/health/database
Invoke-RestMethod http://localhost:5001/api/health/ml
Invoke-RestMethod http://localhost:8000/health

# Phase 4 forecast (fixture-derived; see docs/phase4/)
Invoke-RestMethod http://localhost:5001/api/forecast/ONION/MH_PUNE_APMC
```

---

## 5. Phase 4 — price forecasting (added here)

Phase 4 is implemented and verified; see [docs/phase4/](docs/phase4/README.md) for
the full design. Local specifics:

```powershell
# Train (deterministic development fixture: seeds + trains + evaluates)
cd backend; npm run forecast:train -- --fixture

# Generate the 1-7 day forecasts and persist them
npm run forecast:generate -- --model-version phase4-fixture-v1

# List trained artefacts
npm run forecast:list
```

These wrappers locate `ml-service\venv` automatically (or set `ML_PYTHON`).

> **The Phase 4 metrics are measured on DEVELOPMENT FIXTURE DATA**, because this
> repository/database has no genuine mandi history (no `DATA_GOV_IN`/`CEDA` keys).
> They are not real-world accuracy claims. Every generated forecast is stored with
> `data_source='FIXTURE'` and shown in the UI with a "Fixture data" notice.

---

## 6. Verification results

| Check | Result |
|-------|--------|
| `backend`: `npm run test:unit` | **143 passed, 0 failed** |
| `backend`: `npm run test:db` (disposable DB) | **125 passed, 0 failed** |
| `ml-service`: `python -m unittest discover -s tests -t .` | **114 tests, OK** (13 skipped: DB tests) |
| `ml-service`: `tests/test_data_db.py` (in a disposable DB) | **13 passed, 0 failed** |
| `frontend`: `npm run check:i18n` | **289 keys present** in en/hi/mr |
| `frontend`: `npm run lint` | 16 warnings, **0 errors** (all pre-existing) |
| `frontend`: `npm run build` | succeeded |
| Database migrations | 6 applied, 0 pending |
| Live API + frontend | HTTP 200; `/api/forecast/ONION/MH_PUNE_APMC` returns 7 forecast rows |

`npm run check:i18n` also reports pre-existing duplicate-key warnings in
`frontend/src/i18n/strings.js` (`header.status.*`, `auth.mobileNumber`,
`auth.account`). These are upstream and do not fail the check.

### Reproducing the Python database tests

`ml-service/tests/test_data_db.py` is opt-in (it needs a disposable database):

```powershell
# create + migrate a throwaway database, then run the tests against it
$env:DB_NAME='fasalytics_test_py4'; $env:PHASE4_DB_TESTS='1'
cd backend; node scripts/migrate.js
cd ..\ml-service; .\venv\Scripts\python.exe -m unittest tests.test_data_db
```


---

## 7. Credentials still to be filled in

The following are placeholders in the copied `.env` files; the stack runs
without them but the related features stay disabled.

### Firebase (blocks all authentication)

Required for signup, login, Google, and phone OTP. In the
[Firebase Console](https://console.firebase.google.com) create a project and set:

- `frontend/.env` — `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
- `backend/.env` — `FIREBASE_PROJECT_ID` (same project), plus a service account
  via `FIREBASE_SERVICE_ACCOUNT_PATH` for admin operations

Currently `backend/.env` has `FIREBASE_PROJECT_ID=your-firebase-project-id`, and
the backend reports `Firebase Auth: ready` for that placeholder project. Farmer
endpoints correctly return **401** without a token, but real sign-in cannot work
until genuine values are supplied.

### Email (optional)

`EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`. Without them, registrations
still complete and deliveries are recorded as `not_configured`.

### Mandi data providers (optional)

`DATA_GOV_IN_API_KEY` and `CEDA_API_KEY` are empty and
`MANDI_DATA_PROVIDER` is empty (no provider), so no ingestion runs and the
scheduler stays off — matching the README's safe defaults. The mandi tables are
intentionally empty.
