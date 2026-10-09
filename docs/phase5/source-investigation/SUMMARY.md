# Phase 5 — Source Investigation Summary

Investigation date: **2026-10-09**. Per-source detail in `CEDA.md`, `AGMARKNET.md`,
`DATA-GOV-IN.md`.

## Verdicts

| Source | Verdict | One-line reason |
|---|---|---|
| **CEDA** | `ACCESSIBLE` | Key is valid and catalogue endpoints return real data, but `/prices` request contract is unresolved and the API is now returning 429 on every endpoint. |
| **AGMARKNET** | `BLOCKED-NO-PUBLIC-API` | agmarknet.gov.in publishes no API. It is the *original producer*, not an integrator. Correctly kept as a deprecated alias for `DATA_GOV_IN`. |
| **data.gov.in** | `BLOCKED` | Akamai edge resets every TLS session to `api.data.gov.in` from this network. Unrelated to credentials. |

## Evidence table

| Endpoint | Result | Evidence URL | Status |
|---|---|---|---|
| `GET api.ceda.ashoka.edu.in/v1/agmarknet/commodities` (Bearer) | `200`, 23,290 bytes, 453 commodities | — | `VERIFIED` |
| `GET .../v1/agmarknet/geographies` (Bearer) | `200`, 73,674 bytes, 640 rows | — | `VERIFIED` |
| `GET .../v1/agmarknet/commodities` (no auth) | `401 Unauthorised, no api key passed.` | — | `VERIFIED` |
| `GET .../v1/agmarknet/prices` | `404 Cannot GET /v1/agmarknet/prices` | — | `VERIFIED` |
| `POST .../v1/agmarknet/prices` | `400 {"type":"error","message":"Commodity id, state id, start and end date are required"}` | — | `VERIFIED` |
| `GET .../v1/agmarknet/markets`, `/quantities` | `404` | — | `VERIFIED` |
| All CEDA endpoints after quota exhaustion | `429 Too many requests, please try again later.` (did not recover after ~5 min) | — | `VERIFIED` |
| `GET api.data.gov.in/` and `/resource/<id>` | `ECONNRESET` during TLS handshake (also via curl: `(35) Recv failure`) | — | `VERIFIED` |
| `GET www.data.gov.in/` | `200`, ~1.2 MB | — | `VERIFIED` |
| `GET www.data.gov.in/resource/<id>` | `302` | — | `VERIFIED` |
| `GET www.data.gov.in/search?title=…` | `200` once, then Akamai `errors.edgesuite.net` 102 block | — | `VERIFIED` |
| CEDA portal JS bundle | exact `/prices` + `/quantities` request bodies recovered | https://agmarknet.ceda.ashoka.edu.in/_next/static/chunks/app/page-aa7bcb85c5cc9efa.js | `VERIFIED` |
| CEDA Swagger UI | serves petstore spec — unconfigured, no usable contract | https://api.ceda.ashoka.edu.in/documentation/ | `VERIFIED` |
| CEDA terms & citation | non-commercial; required citation text | https://ceda.ashoka.edu.in/api-terms-conditions/ | `DOCUMENTED` |
| CEDA data portal | product page | https://ceda.ashoka.edu.in/data-portal/ | `VERIFIED` |
| CEDA Agri Market portal | source attribution (DMI) | https://agmarknet.ceda.ashoka.edu.in/ | `VERIFIED` |

## Corrections to existing project documentation

1. `docs/PHASE3_SOURCE_ACCESS.md` records **both** CEDA and data.gov.in as `BLOCKED`
   (TCP refused). **CEDA is reachable and the configured key works.** That note is
   stale and should be amended.
2. `backend/src/pipeline/providers/ceda.provider.js` documents
   `GET /agmarknet/markets` and `GET /agmarknet/quantities`, and assumes
   `GET`-style `/prices`. Measured reality: **`/markets` and `/quantities` are not
   reachable by GET (404)**, and `/prices` is **POST-only (GET → 404)**. The provider's
   catalogue readers also assume a nested
   `{commodities:[…]}` / `{geographies:[{districts:[…]}]}` envelope, whereas the live API
   returns a **flat** `output.data[]` with `commodity_id`/`commodity_name` and
   `census_state_id`/`census_district_id`.
3. The adapter's assumed `state_id`/`district_id` are **not** the `census_state_id` /
   `census_district_id` values the live `/geographies` endpoint returns.

These are real defects and are the reason a real CEDA ingestion cannot yet be
claimed to work.

## The AGMARKNET alias decision

**Keep `AGMARKNET` as a deprecated alias of `DATA_GOV_IN`. Do not build
`agmarknet.provider.js`.**

Justification: agmarknet.gov.in and the state `agmarknetonline.*` portals are
server-rendered web applications with no published API, documentation, key, or spec.
The data reaches integrators through the OGD platform (`DATA_GOV_IN`) and through CEDA
— the two paths this project already uses. Building a third, scraping-based adapter
would add fragility and licensing exposure for zero new data.

## Cross-cutting finding: the three sources are not independent

CEDA and data.gov.in **both republish DMI / Agmarknet records**. Verified from CEDA's
own footer and the OGD dataset's documented provenance.

Therefore:
- CEDA ↔ data.gov.in overlap is **expected** and must not be reported as an anomaly.
- A price disagreement between them is more likely a **revision or publication lag**
  than two independent measurements.
- The dedup layer must guarantee that **one underlying DMI observation is never
  counted twice** for ML training, and must record every contributing source rather
  than silently discarding the loser.
- `SOURCE_PRECEDENCE` (`DATA_GOV_IN` 40 > `CEDA` 30) is the documented tie-break.

## What must be resolved before any bulk ingestion

| # | Blocker | Needed to resolve |
|---|---|---|
| 1 | CEDA `/prices` + `/quantities` request contract | Retry after quota reset, or a CEDA support request. Do not guess field names. |
| 2 | CEDA `/markets` (POST) contract | Same. |
| 3 | CEDA real date coverage | Same. |
| 4 | CEDA rate-limit recovery window | Same — quota did not recover in ~5 minutes. |
| 5 | data.gov.in live contract (fields, pagination, limits, coverage) | Network change / whitelisted egress, plus a real `DATA_GOV_IN_API_KEY`. |
| 6 | `DATA_GOV_IN_API_KEY` | Free key at https://data.gov.in. Not present in `backend/.env`. |

## Explicitly NOT done

- No endpoint, field name, limit, or coverage figure in these documents was invented.
- No access control, CAPTCHA, rate limit, or WAF restriction was bypassed. When CEDA
  began returning 429, probing **stopped** and the remaining questions were recorded
  as blocked rather than worked around.
- No bulk download was performed. All CEDA responses touched during investigation were
  small catalogues (≤74 KB).