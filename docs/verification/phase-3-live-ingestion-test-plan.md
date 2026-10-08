# FASALYTICS — Phase 3 small real-source ingestion test plan

**Status: PREPARED, NOT EXECUTED.** Nothing in this plan has been run. It needs your approval, two API keys and (for data.gov.in) a network that can reach `api.data.gov.in`.
Written 2026-10-09 · Branch `integration/phase3-on-d`.

## 1. Goal and scope

Prove, with the smallest possible amount of real data, that one genuine record travels correctly through every stage:

```
official source → raw response → normalizer → validator → de-duplicator → PostgreSQL → Express API → React dashboard
```

This is acceptance criterion 13 of the recovery brief. It is deliberately small:

| Limit | Value |
|---|---|
| CEDA | 1 commodity (Onion) × 1 district (Maharashtra / Nashik) × **7 days** (`2026-09-01..2026-09-07`, inside the 2021-10-01..2026-09-30 window), `--max-tasks=1`, 20 MB budget |
| data.gov.in | Onion, Maharashtra, the **3 most recent reporting days**, `--max-records=50` |
| Database | a **new, isolated** database `fasalytics_test_live_<id>` — never `fasalytics` |
| Scheduler | stays off (`MANDI_SYNC_INTERVAL_MINUTES=0`) |
| Not part of this test | the five-year nationwide download, any write to the development database, enabling the scheduler, Phase 4 |

## 2. Gates (nothing starts until all are true)

| # | Gate | Who | Current state (2026-10-09) |
|---|---|---|---|
| G1 | You approve running this plan | you | pending |
| G2 | `CEDA_API_KEY` (register at https://api.ceda.ashoka.edu.in/, non-commercial use, attribute CEDA) | you | **not set** |
| G3 | `DATA_GOV_IN_API_KEY` (register at https://data.gov.in) | you | **not set** |
| G4 | Network path to `api.data.gov.in:443` | you / network admin | **refused** (`ECONNREFUSED`) — CEDA part can still run alone |
| G5 | `npm run live:preflight` prints READY for the chosen source | assistant | NOT READY (G2–G4) |
| G6 | Backend tests green (`npm run test:unit`, `npm run test:db`) | assistant | **132 / 132 and 94 / 94 passing** |

The CEDA part and the data.gov.in part are independent: if only G2 is met, run Parts A–B only.

## 3. Safety design

- **Credentials** are set as environment variables in the terminal session only (never in `backend/.env`, never on a command line — the CLIs reject `--api-key`, `--token`, … arguments). They disappear when the terminal closes; step 11 also removes them explicitly.
- **Isolation:** every command below runs with `DB_NAME` pointing at the new test database, and the write commands additionally require `--confirm-db=<that name>`. `live:db` only creates/drops databases it marked itself; `live:preflight` fails unless the target is a `fasalytics_test_live_*` database.
- **Nothing is deleted automatically.** Downloaded files stay in `backend/data/mandi` (git-ignored). Dropping the test database is a separate command that needs your approval.
- **No credentials in output:** errors, run records, exported files and manifests are scrubbed and tested for that (`test/credential-handling.test.js`). The data.gov.in API takes its key as a URL query parameter by design; it is redacted from every log and is protected in transit by HTTPS.
- **Stop conditions:** abort and report if any command returns 401/403 (bad key), repeated 429 (rate limit), a disk-space or budget stop, units that are not INR/quintal and tonnes, or any output that shows a credential.

## 4. Setup (PowerShell, once per session)

```powershell
cd D:\Projects\AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-\backend

# Enter keys without echoing them and without writing them to any file (works in Windows PowerShell 5.1 and 7)
function Read-Secret($prompt) {
  $s = Read-Host $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
$env:CEDA_API_KEY        = Read-Secret "CEDA API key"
$env:DATA_GOV_IN_API_KEY = Read-Secret "data.gov.in API key"     # skip if G4 is not met

# Name of the isolated database (used by every step below). DB_NAME is NOT set yet.
$env:LIVE_DB = "fasalytics_test_live_20261009"
```

## 5. Steps

### Step 0 — create the isolated database (applies migrations 002–005)
Run this with `DB_NAME` **unset**: `live:db` takes the target from `--name`, connects through the maintenance database `postgres`, and refuses a name equal to the configured `DB_NAME`. It never opens `fasalytics`.
```powershell
npm run live:db -- create --name=$env:LIVE_DB
npm run live:db -- status --name=$env:LIVE_DB      # migrations: 4 applied, 0 pending; genuine_rows 0
```
From here on, point every ingestion/trace command at that database for this terminal session:
```powershell
$env:DB_NAME = $env:LIVE_DB
```

### Step 1 — preflight (no API request, no credential printed)
```powershell
npm run live:preflight -- --source=ceda        # or --source=data-gov-in, or no flag for both
```
Expected: every line `PASS` (it also checks that `DB_NAME` is a `fasalytics_test_live_*` database). Stop if not.

### Part A — CEDA (historical)
**Step 2 — discovery only (3 small calls, no prices, writes nothing).** Confirms the numeric IDs and that the credentials work.
```powershell
npm run ceda:export -- --commodity=Onion --state=Maharashtra --district=Nashik --discover-only
```
Check: a commodity id, state id, district id and a non-empty market list. *Open question to settle here:* whether `GET /agmarknet/geographies` needs a `commodity_id` (the API spec lists a 400 for it but no parameter). If it returns 400, the fix is a one-line change in `CedaClient.listGeographies` — report back rather than working around it.

**Step 3 — one 7-day window, to files only (no database).**
```powershell
npm run ceda:export -- --commodity=Onion --state=Maharashtra --district=Nashik `
  --from=2026-09-01 --to=2026-09-07 --window-days=7 --max-tasks=1 --budget-mb=20
```
Check in `backend\data\mandi\ceda\...`: the `.csv.gz` (open with 7-Zip), the raw `.raw.json.gz`, and the manifest (`status: done`, `csvSha256` present). Look at `rowsValid` / `rowsRejected` and `rejection_codes`. **Confirm the units** (prices ₹/quintal, quantities tonnes) against a value shown on https://agmarknet.ceda.ashoka.edu.in/ for the same market and day.

**Step 4 — import those files into the isolated database.**
```powershell
npm run ceda:export -- --import-manifest=data\mandi\manifest_c<id>_s<id>_d<id>.json --confirm-db=$env:LIVE_DB
```
Expected: `inserted` = rowsValid, `failed` = 0.

### Part B — data.gov.in (current prices) — only if G3 and G4 are met
**Step 5 — a tiny current-price sync into the isolated database.**
```powershell
# use the three most recent days, e.g. today 2026-10-09:
npm run mandi:sync -- --provider=DATA_GOV_IN --state=Maharashtra --commodity=Onion `
  --from=2026-10-07 --to=2026-10-09 --max-records=50 --confirm-db=$env:LIVE_DB
```
Expected: `status: SUCCESS` (or `NO_DATA` if the portal has no rows for those days — then try earlier days). Check `records_fetched`, `rejection_summary`, and that the rows carry the flag `PRICE_UNIT_FROM_PUBLISHER_CONVENTION` unless the response declared the unit. *Open questions to settle here:* the exact `filters[arrival_date]` syntax, the response field names, and the unit — any difference is a small adapter change; report it.

### Step 6 — verify the database (pgAdmin 4 → Query Tool on `fasalytics_test_live_…`)
```sql
SELECT source, is_sample_data, COUNT(*) AS rows, MIN(price_date) AS first_day, MAX(price_date) AS last_day,
       COUNT(*) FILTER (WHERE min_price IS NULL OR max_price IS NULL) AS missing_min_max,
       COUNT(*) FILTER (WHERE arrivals_quantity IS NULL)              AS missing_arrivals
FROM mandi_prices GROUP BY 1, 2 ORDER BY 1;                      -- no is_sample_data = true rows expected

SELECT status, mode, records_fetched, records_valid, records_inserted, records_unchanged,
       records_rejected, records_failed, conflicts_detected, rejection_summary
FROM pipeline_sync_logs ORDER BY id;                             -- counts must add up to the rows above

SELECT source, last_status, last_success_at, latest_reporting_date FROM mandi_source_sync_state;
SELECT conflict_type, status, COUNT(*) FROM mandi_price_conflicts GROUP BY 1, 2;   -- review any rows
SELECT m.state, m.district, m.name, c.name AS commodity, p.variety, p.price_date,
       p.min_price, p.max_price, p.modal_price, p.price_unit, p.arrivals_quantity, p.arrival_unit, p.source
FROM mandi_prices p JOIN mandis m ON m.id = p.mandi_id JOIN commodities c ON c.id = p.commodity_id
ORDER BY p.price_date DESC, m.name LIMIT 20;
```

### Step 7 — the record trace (acceptance criterion 13)
```powershell
npm run trace:record -- --source=CEDA --out=..\docs\verification\evidence\trace-ceda.json
npm run trace:record -- --source=DATA_GOV_IN --out=..\docs\verification\evidence\trace-data-gov-in.json
```
Each prints six stages and ends with a verdict. `GENUINE_TRACE_PASS` is only possible for a non-sample row from a genuine source whose raw payload re-normalises to exactly the stored values and matches the API response. Compare the printed `expected_text` with the browser in step 9, and compare the raw values with the official site (CEDA portal / data.gov.in resource page) by eye for the same market and day.

### Step 8 — serve the isolated database through the backend
```powershell
$env:PORT = "5055"
npm start                                   # separate terminal; scheduler stays off; Ctrl+C when done
```
In another terminal: `Invoke-RestMethod "http://localhost:5055/api/mandi/prices/latest?commodity=ONION&includeSample=false"` — rows must show `source`, `source_label`, `price_date`, `fetched_at`, `is_sample_data: false`, and `meta.latest_genuine_reporting_date`.

### Step 9 — the dashboard (manual, needs a login)
```powershell
cd ..\frontend
$env:VITE_API_URL = "http://localhost:5055"
npm run dev -- --port 5174
```
Open http://localhost:5174, sign in, and check **Home → Today's Mandi Prices** and **Mandis** in English, Hindi and Marathi: market name, ₹ modal price per quintal, "Reported <date>", the source line, no DEMO badge, no raw translation keys, and the Data Freshness tile showing the latest genuine reporting date. Stop the dev server afterwards.

### Step 10 — idempotency
Repeat step 4 (and step 5). Expected: `inserted: 0`, `unchanged` = the earlier `inserted`, no new conflicts.

### Step 11 — clean up (keys first)
```powershell
Remove-Item Env:CEDA_API_KEY, Env:DATA_GOV_IN_API_KEY, Env:DB_NAME, Env:PORT, Env:VITE_API_URL -ErrorAction SilentlyContinue
```
Keep the isolated database and the files until you have reviewed the evidence. **Dropping the database is a separate step that needs your approval:**
`Remove-Item Env:DB_NAME; npm run live:db -- drop --name=<name> --confirm-drop=<name>` (`DB_NAME` must be unset; the command refuses any database it did not create). Nothing in `backend\data\mandi` is deleted by any command.

## 6. Pass / fail criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | CEDA discovery returns IDs and markets | step 2 output |
| 2 | CEDA window exported; checksums in manifest; no key in any file | step 3, manifest |
| 3 | Rows stored with correct commodity, variety, market, state, district, date, min/max/modal, units, source | steps 4, 6 |
| 4 | Missing values are NULL; rejected rows have reason codes | step 6 |
| 5 | Re-import is idempotent | step 10 |
| 6 | API returns the record with source and reporting date | step 8 |
| 7 | `trace:record` verdict `GENUINE_TRACE_PASS` for at least one record | step 7 JSON |
| 8 | Dashboard shows the same values, source and reporting date in all 3 languages | step 9 |
| 9 | No credential visible in terminal output, logs, run records or files | all steps |
| 10 | The development database `fasalytics` is unchanged | `npm run migrate:status` shows 004/005 still pending |

The test **passes** only if criteria 1–10 hold for at least the CEDA part. If data.gov.in is unreachable, the report must keep data.gov.in as **BLOCKED**; a CEDA-only pass does not make Phase 3 COMPLETE.

## 7. Evidence for `phase-3-recovery-report.md`

Paste (with credentials absent by construction): the preflight output, the discovery summary (ids and market count), manifest summary, the step 6 query results, both trace JSON files, the API response excerpt, and a screenshot of each dashboard language. Record the real sample row counts and the latest reporting date per source — these replace the current "0 / BLOCKED" entries.

## 8. After a pass — separate approvals

1. Apply migrations 004/005 to the development database (`npm run migrate:rehearse` first, then `npm run migrate`).
2. First ingestion into `fasalytics` with `--confirm-db=fasalytics`.
3. Configure a Firebase service account on the server **only if** HTTP-triggered ingestion is wanted (see `docs/authentication.md`, "Administrator claim").
4. Enable the scheduler (`MANDI_SYNC_INTERVAL_MINUTES ≥ 15`, `MANDI_DATA_PROVIDER=DATA_GOV_IN`) — not before.
5. Larger CEDA history: one commodity and district at a time, with the disk guard, only after the sample is reviewed.

## 9. Known unknowns this test resolves

| Unknown | Where it is settled |
|---|---|
| Does `GET /agmarknet/geographies` need a `commodity_id`? | step 2 |
| CEDA rate limits and response size for a 7-day window | step 3 |
| Do CEDA and data.gov.in market names align (cross-source matching is name-based)? | steps 4–5, `mandi_price_conflicts` and the resolved view |
| data.gov.in date-filter syntax, field names, unit, and the latest available reporting day | step 5 |
| Are Hindi/Marathi mandi names needed for real markets (only four fixture mandis are translated)? | step 9 |
