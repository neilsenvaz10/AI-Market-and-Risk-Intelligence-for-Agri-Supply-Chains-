# Phase 5 — Operations Runbook (PowerShell)

Every command below is real and exists in this repo. Run them from `backend\`.
Nothing here has been executed against a live source or a live database except
where explicitly marked.

## 0. Before anything else — know the current state

```powershell
cd "E:\AA Kushal\AAA-Coding\Hackathon\Syrus 7.0 2\backend"

# What does the code believe about each source? Never prints a key.
node scripts/mandi-ingest.js sources

# Which sources are configured and reachable? (exit 3 = blocked)
node scripts/mandi-ingest.js --json sources
```

Verified on 2026-10-09:

| Source | Credential | Reachable | Notes |
|---|---|---|---|
| `CEDA` | present | yes | `/prices` request contract **UNRESOLVED**; provider is gated behind an explicit flag and refuses by default. |
| `DATA_GOV_IN` | **absent** | n/a | `api.data.gov.in` is blocked at the Akamai/WAF edge from this network (`ECONNRESET` during TLS). |

## 1. Install dependencies

```powershell
cd "E:\AA Kushal\AAA-Coding\Hackathon\Syrus 7.0 2\backend"; npm install
cd ..\frontend; npm install
```

## 2. Configure credentials

```powershell
Copy-Item backend\.env.example backend\.env
```

Then edit `backend\.env`:

| Variable | Required for | How to get it |
|---|---|---|
| `CEDA_API_KEY` | CEDA | Free — https://api.ceda.ashoka.edu.in/ (email + organisation → OTP → key). **Already present.** |
| `DATA_GOV_IN_API_KEY` | data.gov.in | Free — https://data.gov.in → sign in → profile → API key. **Not present.** |

Verify without printing the key:

```powershell
node scripts/mandi-ingest.js sources
```

## 3. Database

Docker is **not installed** on this machine. If you have Docker elsewhere:

```powershell
docker compose up -d
cd backend; npm run migrate; npm run migrate:status
```

A fresh volume now initialises through migration `007`, so `mandi_prices_canonical`
exists immediately. An **existing** volume needs `npm run migrate`.

## 4. Check source connectivity

```powershell
node scripts/mandi-ingest.js sources
npm run live:preflight -- --source=all
```

## 5. Discover commodities / mandis / geographies

```powershell
# CEDA catalogue (works today - verified)
node scripts/mandi-ingest.js discover --source=ceda --limit=20

# data.gov.in returns field metadata + total count, because the platform has no
# commodity/market catalogue endpoint. Inventing one would be fabrication.
node scripts/mandi-ingest.js discover --source=data-gov-in
```

## 6. Preview a batch (no database writes)

```powershell
# CEDA refuses unbounded sweeps - commodity, state AND district are all mandatory.
node scripts/mandi-ingest.js sample --source=ceda --days=1 --limit=5 `
  --commodity=Onion --state=Maharashtra --district=Nashik
node scripts/mandi-ingest.js preview --source=ceda --days=1 --limit=20 `
  --commodity=Onion --state=Maharashtra --district=Nashik
```

`sample`/`preview` are hard-capped: `--days` max 7, `--limit` max 2500,
`--max-pages` max 5. They never write to PostgreSQL.

## 7. Small authorized samples per source

```powershell
# CEDA - requires a bounded scope (commodity + state + district).
# Today this REFUSES with CEDA_CONTRACT_UNVERIFIED (see Known blockers).
node scripts/mandi-ingest.js sample --source=ceda --days=1 --limit=10 `
  --commodity=Onion --state=Maharashtra --district=Nashik

# data.gov.in - exit 3 (blocked: no credential, host unreachable from this network)
node scripts/mandi-ingest.js sample --source=data-gov-in --days=1 --limit=10
```

**Current status:** the CEDA command exits `1` with `CEDA_CONTRACT_UNVERIFIED`. That
is deliberate — see §13. The data.gov.in command exits `3`.

## 8. Validate records

# Validate records

```powershell
node scripts/mandi-ingest.js preview --source=ceda --days=1 --limit=50 `
  --commodity=Onion --state=Maharashtra --district=Nashik --json
node scripts/mandi-ingest.js status
```

Quality and provenance report (read-only, never writes to PostgreSQL):

```powershell
node scripts/quality-report.js
node scripts/quality-report.js --json
node scripts/quality-report.js --exclude-sample --disk-path=backend\data
```

## 9. Disk usage and budget

```powershell
node scripts/data-usage.js
node scripts/data-usage.js --json --dir=backend\data --budget-gb=10
```

Exit `2` means the budget or the disk floor is not satisfied. Measured on
2026-10-09: **97.6 GB free on E:** (the repo volume), 0 B used, `backend\data\`
does not exist yet.

## 10. Incremental updates (current prices)

```powershell
# Default window comes from MANDI_SYNC_LOOKBACK_DAYS (default 3).
node scripts/mandi-ingest.js incremental --source=data-gov-in --lookback-days=3 --confirm-db=fasalytics

node scripts/mandi-ingest.js incremental --source=all --lookback-days=7 --confirm-db=fasalytics
```

`--confirm-db=<DB_NAME>` is mandatory: it echoes the database so you cannot
write to the wrong one by accident.

### Scheduling

```powershell
$env:MANDI_DATA_PROVIDER='data-gov-in'
$env:MANDI_SYNC_INTERVAL_MINUTES='60'      # 15..10080; 0 = disabled
$env:MANDI_SYNC_LOOKBACK_DAYS='3'          # 1..30, captures late reports
node src/server.js
```

`MANDI_SYNC_INTERVAL_MINUTES` only enables `DATA_GOV_IN` (the scheduler's
`SCHEDULABLE_PROVIDERS`). Overlapping runs are prevented by a PostgreSQL
advisory lock. **This is a periodic refresh, not real-time streaming.**

## 11. Full historical ingestion — REQUIRES YOUR EXPLICIT APPROVAL

**Do not run this. It is documented so the command is available when you
approve it, not because it is ready.**

```powershell
# Step 1 — estimate only. Downloads nothing. This is what you should run first.
node scripts/mandi-ingest.js estimate --from=2021-10-01 --to=2026-09-30

# Step 2 — bounded dry run. Still downloads nothing; shows the refusal + plan.
node scripts/mandi-ingest.js historical --from=2021-10-01 --to=2026-09-30 `
  --state="Maharashtra" --district="Nashik" --commodity="Onion"

# Step 3 — THE ONLY COMMAND THAT DOWNLOADS NATIONWIDE DATA.
# Requires BOTH a bounded scope AND this exact literal token:
node scripts/mandi-ingest.js historical --from=2021-10-01 --to=2026-09-30 `
  --state="Maharashtra" --district="Nashik" --commodity="Onion" `
  --max-rows=1000000 `
  --confirm-full-run=YES-DOWNLOAD-FIVE-YEAR-NATIONWIDE-HISTORICAL-BACKFILL
```

Token for `cleanup`: `YES-DELETE-RAW-DOWNLOADED-DATA`.

## 12. Resume an interrupted download

```powershell
node scripts/mandi-ingest.js resume --print-only
node scripts/mandi-ingest.js resume
```

`resume` needs **no** token — it can only ever reduce work, never start new work.
Progress lives in an atomic manifest
(`<data-dir>/<source>/<dataset>/manifest_*.json`) with a sha256 integrity block.

## 13. Cleanup (opt-in)

```powershell
node scripts/mandi-ingest.js cleanup --dry-run      # preview only - no token needed
node scripts/mandi-ingest.js cleanup                # refuses (exit 2) without the token
node scripts/mandi-ingest.js cleanup --confirm-cleanup=YES-DELETE-RAW-DOWNLOADED-DATA
```

Raw data is kept until validation succeeds. Deletion is opt-in and never touches
the database. A `--dry-run` deletes nothing and therefore needs no token.

## Storage safety model

| Guard | Behaviour |
|---|---|
| Hard free-space floor | **10 GB**, cannot be lowered by any flag or env var. `resolveMinFreeGb` returns `Math.max(requested, 10)`. |
| Fails closed | If free space cannot be determined, the run refuses with `DISK_SPACE_UNKNOWN` (exit `2`). It never guesses. |
| Budget | Default **10 GB** of local working data (`createBudget`), measured by walking the tree — never from counters. |
| 429 handling | CEDA returns `429 Too many requests`. Back off hard; do not assume recovery. |
| Atomic writes | Sibling temp + `fsync` + `rename`. A crash never leaves a half-written dataset. |
| Partitions | `<data-dir>/<source>/<dataset>/<year>/<month>.csv.gz` — no giant combined files. |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error / usage |
| `2` | Safety refusal (budget, disk floor, unknown free space, missing/wrong token, cap exceeded) |
| `3` | Blocked (missing credential, unreachable source) |

## 14. Tests

```powershell
cd backend
npm run test:unit          # 295 tests, 294 pass, 1 DB-gated skip (2026-09-09)
npm run test:db            # needs Docker + PostgreSQL; NOT run - no Docker on this machine

cd ..\frontend
node --test test/market-api.test.mjs   # 83 tests, 83 pass
npm run lint
npm run check:i18n
```

## Known blockers (read before planning ingestion)

1. **CEDA `/prices` and `/quantities` request contracts are UNRESOLVED.** The
   provider refuses by default with `CEDA_CONTRACT_UNVERIFIED`. Requires a CEDA
   support request or a retry after quota reset. Do not guess the field names.
2. **data.gov.in is network-blocked** (`ECONNRESET` from the Akamai edge) and has no
   API key configured.
3. **`npm run test:db` has never run** — no Docker/PostgreSQL on this machine. The
   canonical view has never been created in a live database.
4. **`RecommendationResultPage.jsx` and `AskAiPage.jsx` still render fabricated
   prices** (`₹19,800`, `₹2,050`, `₹1,920`) with no API call. HomePage's hero numbers
   are labelled `home.demoBadge`; these two pages are not.