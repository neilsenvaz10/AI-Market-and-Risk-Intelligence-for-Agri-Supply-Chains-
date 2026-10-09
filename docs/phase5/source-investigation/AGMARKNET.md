# Source Investigation — AGMARKNET

Investigation date: **2026-10-09**.

## Verdict

**`BLOCKED-NO-PUBLIC-API`**

Agmarknet exposes **no documented public API**. There is nothing for FASALYTICS to
integrate. This is a deliberate, recorded design decision — not a missing feature.

## What Agmarknet is

| Property | Value | Status |
|---|---|---|
| Operator | Directorate of Marketing & Inspection (DMI), Ministry of Agriculture and Farmers Welfare, Government of India | `VERIFIED` |
| Primary site | https://agmarknet.gov.in | `DOCUMENTED` |
| State portal example | https://agmarknetonline.cg.gov.in (Chhattisgarh) | `DOCUMENTED` |
| Role in this project | **Original producer** of the underlying records, not an integrator | `VERIFIED` |

The official footer of CEDA's own portal reads:

> Source: Directorate of Marketing & Inspection (DMI), Ministry of Agriculture and
> Farmers Welfare, Government of India

That is the decisive fact: **CEDA and data.gov.in are two access paths to the same DMI
Agmarknet data.** They are not independent sources.

## Why there is no API

| Property | Status |
|---|---|
| A documented, stable, public HTTP/JSON API at agmarknet.gov.in | `NOT_FOUND` |
| Published developer documentation, key registration, or OpenAPI/Swagger spec | `NOT_FOUND` |
| State-level portals (e.g. `agmarknetonline.cg.gov.in`) offering a public API | `NOT_FOUND` |

The national and state portals are server-rendered web applications. Their data
endpoints are internal implementation details behind UI session state, not a
published contract. Anything that reached them by reading their internal XHR traffic
would be reverse-engineering a private interface, and FASALYTICS does not do that.

## Project decision (already in the codebase)

`backend/src/config/mandiConfig.js:16-18`:

```js
// Older .env files used AGMARKNET for the data.gov.in adapter; the data never came
// from agmarknet.gov.in directly, so the name is mapped to its real source.
const PROVIDER_ALIASES = { AGMARKNET: 'DATA_GOV_IN' };
```

`backend/src/pipeline/index.js:27` repeats the mapping. Setting
`MANDI_DATA_PROVIDER=AGMARKNET` logs a deprecation warning and resolves to
`DATA_GOV_IN`.

This is **correct** and is carried into Phase 5 unchanged. An `agmarknet.provider.js`
would be a scraping layer against a site with no public API — legally fragile,
technically brittle, and a supply-chain risk for the pipeline.

## Consequences for Phase 5

| Concern | Resolution |
|---|---|
| Adapter | **None.** Do not create `agmarknet.provider.js`. |
| Source-precedence | `AGMARKNET` is not a source code. Canonical source codes stay `DATA_GOV_IN` (precedence 40) and `CEDA` (precedence 30). See `database/migrations/005_mandi_pipeline_integrity.sql:32-39`. |
| Cross-source independence | CEDA and data.gov.in **overlap heavily** because both republish DMI/Agmarknet. The Phase 5 dedup layer must treat their overlap as expected, not as an anomaly, and must never count one underlying DMI observation twice. |
| Docs | `docs/PHASE3_SOURCE_ACCESS.md` already records this. Kept consistent here. |

## Credentials required

**None.** Nothing is obtainable, because nothing is published.

## What remains blocked and why

Everything, permanently — unless DMI publishes an official API, at which point this
file should be revisited. Any DMI-published endpoint would most plausibly surface
through the Open Government Data platform (see `DATA-GOV-IN.md`) rather than from
agmarknet.gov.in directly.