# Source Investigation — data.gov.in (Open Government Data Platform India)

Investigation date: **2026-10-09**.

## Verdict

**`BLOCKED` — network-level, from this development machine. Not a credential problem.**

The dataset and resource id in the project's configuration are believed correct and
match the widely documented OGD resource, but **no live response could be retrieved**,
so **no field list, no pagination parameters, no rate-limit policy and no date
coverage could be verified**. Everything below that is not explicitly `VERIFIED` is
therefore documentation-level at best and must not be treated as confirmed.

## Measured connectivity — the evidence

| Probe | Result | Status |
|---|---|---|
| `GET https://api.data.gov.in/` | `ECONNRESET` during the TLS handshake | `VERIFIED` |
| `GET https://api.data.gov.in/resource/<id>?format=json&limit=1` | `ECONNRESET` | `VERIFIED` |
| Same via `curl.exe` | `curl: (35) Recv failure: Connection was reset`, `http_code=000` | `VERIFIED` |
| Same over plain `http://` | `502` from an intermediary | `VERIFIED` |
| TCP `api.data.gov.in:443` | **Reachable** (`TcpTestSucceeded = True`) | `VERIFIED` |
| DNS `api.data.gov.in` | `164.100.61.198` — resolves correctly | `VERIFIED` |
| `GET https://www.data.gov.in/` | **HTTP 200**, ~1.2 MB | `VERIFIED` |
| `GET https://www.data.gov.in/resource/<id>` | HTTP 302 redirect | `VERIFIED` |
| `GET https://www.data.gov.in/search?title=Current Daily Price…` | HTTP 200 once, then `errors.edgesuite.net` 102 block | `VERIFIED` |

DNS resolves and the TCP port accepts connections, but **every TLS session is reset
immediately after the handshake**. `www.data.gov.in` resolves to different addresses
(`23.54.81.155`, `23.54.81.131`, Akamai edge) and works. `api.data.gov.in`
(`164.100.61.198`, NIC India) does not. The intermittent `errors.edgesuite.net` 102
response on `www` confirms an **Akamai WAF is actively inspecting this traffic**.

Conclusion: the block is at the CDN/WAF layer for this network, not a missing key, a
wrong URL, or a server outage. It is consistent with the project having recorded
data.gov.in as `BLOCKED` in `docs/PHASE3_SOURCE_ACCESS.md`.

## Configuration already in the codebase

| Property | Value | Status |
|---|---|---|
| Base URL | `https://api.data.gov.in/resource/<resource-id>` | `DOCUMENTED` |
| Resource id in `backend/src/config/mandiConfig.js` | `9ef84268-d588-465a-a308-a864a43d0070` | `UNVERIFIED` — correct-looking and widely cited, but **not confirmed against a live response** |
| Official title | "Current Daily Price of Various Commodities from Various Markets (Mandi)" | `DOCUMENTED` |
| Auth | `api-key` **query parameter** | `UNVERIFIED` live. Note CEDA's `?api-key=` was verified to be **rejected**; OGD's parameter is a different platform and is expected to accept it, but this is unconfirmed here. |
| Page size used by the adapter | `500` (`PAGE_SIZE` in `data-gov-in.provider.js`) | `UNVERIFIED` |
| Date filter used by the adapter | `arrival_date`, one day per request | `UNVERIFIED` |

The adapter's date-filename convention (`DD/MM/YYYY`, and `0` meaning "not reported"
for min/max) is documented in `backend/src/pipeline/normalizer.js` and is consistent
with the OGD dataset family as publicly described.

## Pagination, filtering, limits — all unverified

| Property | Value | Status |
|---|---|---|
| Pagination params / offsets / total-count field | — | `UNVERIFIED` |
| Rate-limit policy and numeric limits | — | `UNVERIFIED` |
| Response field names | — | `UNVERIFIED` |
| Earliest / latest available reporting date | — | `UNVERIFIED` |
| Bulk CSV export URL pattern | — | `UNVERIFIED` |

**Do not fill these in by assumption.** The adapter must be re-validated against a
real response before any production ingestion.

## Licensing and attribution

| Property | Value | Status |
|---|---|---|
| Platform | Government of India, Open Government Data (OGD) platform | `DOCUMENTED` |
| Underlying producer | Directorate of Marketing & Inspection (DMI) — same underlying data as CEDA | `VERIFIED` (via CEDA's own attribution) |
| Typical OGD terms | Government Work of India licence; attribution to DMI / Ministry of Agriculture and Farmers Welfare is normally required on display | `DOCUMENTED` |

## Relationship to AGMARKNET and CEDA

**data.gov.in and CEDA are not independent sources.** Both republish DMI Agmarknet
records:

- CEDA's portal footer: *"Source: Directorate of Marketing & Inspection (DMI),
  Ministry of Agriculture and Farmers Welfare, Government of India"* — `VERIFIED`.
- The OGD dataset is the DMI-generated "Current Daily Price … (Mandi)" resource —
  `DOCUMENTED`.

Consequences for Phase 5, which the dedup layer must honour:

1. Overlap between `DATA_GOV_IN` and `CEDA` is **expected**, not anomalous.
2. One DMI observation must never be counted twice in ML training.
3. `SOURCE_PRECEDENCE` already ranks `DATA_GOV_IN` (40) above `CEDA` (30) — see
   `backend/src/pipeline/deduplicator.js:16` and
   `database/migrations/005_mandi_pipeline_integrity.sql:32-39`.
4. Because the two are *republications*, a price disagreement between them is more
   likely a **revision/lag** than two independent measurements. Conflicts are recorded,
   never silently overwritten.

## Credentials required

- `DATA_GOV_IN_API_KEY` — **not present** in `backend/.env`. Free registration at
  https://data.gov.in (`Sign in` → user profile → API key). `DOCUMENTED`.
- The three demo keys published in OGD documentation
  (`579b464db66ec23bdd0000017d0wnload`, `…cddc385`, `…7d0wnloa`) were **not** tested,
  because every request to `api.data.gov.in` was reset before the application layer
  was reached. A demo key would not have helped.

## What remains blocked and why

1. **All live verification** — the WAF/CDN resets TLS for this network. Requires a
   different network (e.g. a residential or different-region connection) or a
   formally-requested whitelisted egress.
2. **Everything derived from a real response** — fields, pagination, limits, coverage.

Until then, the `DATA_GOV_IN` adapter is code-complete and unit-tested against
**recorded fixtures**, but its live contract is unproven. It must not be described as
working.