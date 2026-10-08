# FASALYTICS Phase 3: Mandi Data Pipeline — Source Access & Quality Report

This document records the empirical investigation of external agricultural data sources, source access constraints, storage safety protocols, and pipeline operational procedures.

---

## 1. External Source Investigation Matrix

| Attribute | **AGMARKNET / data.gov.in** | **CEDA (Ashoka University)** | **MOCK Provider** |
| :--- | :--- | :--- | :--- |
| **Role** | Live daily market prices & arrivals | 5-Year historical baseline | Local development & CI testing |
| **Coverage** | Active mandis across Indian states | 2,700+ mandis, 300+ commodities | 6 Maharashtra mandis, 6 core crops |
| **Target Period** | Near real-time / daily arrivals | **2021-10-01 to 2026-09-30** | Deterministic rolling 14-day window |
| **API Endpoint** | `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070` | `https://api.ceda.ashoka.edu.in/v1/agri-market/daily-prices` | In-memory procedural generator |
| **Auth Requirements** | Free API Key via [data.gov.in](https://data.gov.in/user/register) | API Key via [CEDA Portal](https://ceda.ashoka.edu.in/) | None |
| **Environment Variable**| `DATA_GOV_IN_API_KEY` | `CEDA_API_KEY` | `MANDI_DATA_PROVIDER=MOCK` |
| **Access Status** | **Blocked (Network Level)**: IP `164.100.61.198:443` actively refuses connections from current host | **Pending Credentials**: API key required from CEDA data portal | **Operational & Verified**: 100% active in DB & tests |
| **Data Fabrication Policy** | **Strict**: Zero fabricated live records; provider skips gracefully with clear audit log | **Strict**: Zero fabricated historical records; provider skips gracefully with clear audit log | Verified sample data explicitly marked with `is_sample_data: true` |

---

## 2. Source-Access Investigation Findings & Blockers

### A. AGMARKNET (data.gov.in)
- **Investigation Result**: The standard Open Government Data platform endpoint `https://api.data.gov.in` maps to `164.100.61.198`. Direct HTTPS connection attempts return `actively refused` / connection timeout from this network environment.
- **Root Cause**: Network firewall or IP whitelisting restrictions enforced by the government data portal infrastructure, combined with the absence of a registered user API key in the default development environment.
- **Remediation Steps**:
  1. Register for an account and free API key at [data.gov.in Register](https://data.gov.in/user/register).
  2. Create/edit `backend/.env` with `DATA_GOV_IN_API_KEY=<your_key>`.
  3. Ensure outbound HTTPS port 443 egress to `api.data.gov.in` is unblocked in your host environment or corporate network.
- **Adapter Implementation**: The `AgmarknetGovProvider` includes multi-page pagination (500 records/page), rate limiting (300ms inter-page pause), 15s abort controller timeouts, date-range filtering (`filters[arrival_date][gte/lte]`), and graceful fallback when credentials are absent.

### B. CEDA Historical Data (Ashoka University)
- **Investigation Result**: Ashoka University's Centre for Economic Data and Analysis (CEDA) Agri-Market Data Portal compiles cleaned Agmarknet daily price time-series since 2000. Access requires a user account and API token.
- **Target Historical Baseline**: **2021-10-01 through 2026-09-30** (5 years).
- **Remediation Steps**:
  1. Register on [CEDA Portal](https://ceda.ashoka.edu.in/) and request Agri-Market API access.
  2. Add `CEDA_API_KEY=<your_key>` in `backend/.env`.
  3. (Optional) Set custom URL via `CEDA_API_URL=https://api.ceda.ashoka.edu.in/v1`.
- **Adapter Implementation**: `CedaProvider` enforces date bounds within `2021-10-01` to `2026-09-30`, maps raw records to the canonical schema (`mandi_name`, `commodity_name`, `price_date`, `min_price`, `max_price`, `modal_price`, `arrivals_quantity`, `unit: quintal`, `source: CEDA`), and gracefully skips when unconfigured.

---

## 3. Storage & Disk Safety Protocols

A nationwide 5-year historical download covers over 2,700 mandis, 300 commodities, and hundreds of millions of daily records. Uncontrolled nationwide downloads would exhaust system memory, saturate disk capacity, and degrade PostgreSQL responsiveness.

The following storage safety mechanisms are implemented:
1. **Batch Safety Cap**:
   - `maxRecords` is strictly enforced and clamped to a maximum of 10,000 records per pipeline run (default: 1,000–2,000).
   - Nationwide unconstrained sweeps are rejected; queries must provide specific commodity, state, or date filters.
2. **PostgreSQL Idempotent Upsert**:
   - Primary uniqueness key: `(mandi_id, commodity_id, price_date, variety, source)`.
   - Repeated ingestion runs update existing rows rather than creating duplicate records, bounding table growth:
     ```sql
     ON CONFLICT (mandi_id, commodity_id, price_date, variety, source)
     DO UPDATE SET
       min_price = EXCLUDED.min_price,
       max_price = EXCLUDED.max_price,
       modal_price = EXCLUDED.modal_price,
       arrivals_quantity = EXCLUDED.arrivals_quantity,
       updated_at = CURRENT_TIMESTAMP
     ```
3. **Audit & Log Retention**:
   - Every sync execution writes a lightweight structured record to `pipeline_sync_logs` tracking duration, records fetched, inserted, updated, and rejected.

---

## 4. Deduplication Architecture

The pipeline supports two deduplication strategies:

### Within-Source Deduplication (Default)
- **Composite Key**: `mandi_code::commodity_code::price_date::variety::source`
- **Conflict Resolution**: Within the same batch/source, retains the record with higher `arrivals_quantity` (or higher `modal_price` if arrivals match). Preserves distinct records originating from different sources.

### Cross-Source Deduplication (`crossSource: true`)
- **Composite Key**: `mandi_code::commodity_code::price_date::variety`
- **Source Priority Hierarchy**:
  1. `DATA_GOV_IN` / `AGMARKNET` (Priority 40) — Live official government arrival records
  2. `CEDA` (Priority 30) — Cleaned academic historical dataset
  3. `MOCK` (Priority 10) — Development and testing reference data
- **Conflict Resolution**: Highest priority source is retained. Ties resolve by higher arrival volume.

---

## 5. Data Quality Report & Audit API

Endpoint: `GET /api/mandi/quality/report`

Returns:
- **Summary**: Total records, distinct mandis, distinct commodities, date range.
- **Source Coverage**: Record count, date range, average modal price grouped by `source` and `is_sample_data`.
- **Integrity Audit**: Real-time validation checks for invalid modal prices, inverted bounds (`min > max`), negative arrivals, and distant future records.
- **Sync Health**: Total sync runs, success rate, execution times, and rejection counts.
- **Storage Safety**: Current table size (`pg_total_relation_size`), database size, and safety limits.

Example response:
```json
{
  "status": "success",
  "data": {
    "generated_at": "2026-10-08T15:27:33.000Z",
    "summary": {
      "total_records": "280",
      "distinct_mandis_covered": "6",
      "distinct_commodities_covered": "6",
      "earliest_record_date": "2026-09-24",
      "latest_record_date": "2026-10-08"
    },
    "source_coverage": [
      {
        "source": "MOCK_PROVIDER",
        "is_sample_data": true,
        "record_count": "280",
        "mandis_count": "6",
        "commodities_count": "6",
        "min_date": "2026-09-24",
        "max_date": "2026-10-08",
        "avg_modal_price": "2980.50"
      }
    ],
    "integrity_audit": {
      "invalid_modal_prices": "0",
      "invalid_price_bounds": "0",
      "negative_arrivals": "0",
      "future_dated_records": "0"
    },
    "storage_safety": {
      "table_size": "80 kB",
      "max_batch_limit": 10000,
      "default_batch_limit": 2000,
      "incremental_upsert_enabled": true
    }
  }
}
```

---

## 6. Windows PowerShell Operational Commands

### Run Full Test Suite (43 Tests)
```powershell
node --test `
  "C:\Users\Admin\Desktop\AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-\backend\test\validator.test.js" `
  "C:\Users\Admin\Desktop\AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-\backend\test\normalizer.test.js" `
  "C:\Users\Admin\Desktop\AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-\backend\test\deduplicator.test.js" `
  "C:\Users\Admin\Desktop\AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-\backend\test\ceda.test.js" `
  "C:\Users\Admin\Desktop\AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-\backend\test\pipeline.test.js" `
  "C:\Users\Admin\Desktop\AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-\backend\test\api.test.js"
```

### Build Frontend
```powershell
npm --prefix "C:\Users\Admin\Desktop\AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-\frontend" run build
```

### Trigger Ingestion via API (PowerShell)
```powershell
# Bounded test sync
Invoke-RestMethod -Uri "http://localhost:5000/api/mandi/sync" -Method POST `
  -Headers @{ "Content-Type" = "application/json" } `
  -Body '{"provider": "MOCK", "days": 3, "limit": 20}'

# Fetch Data Quality Report
Invoke-RestMethod -Uri "http://localhost:5000/api/mandi/quality/report" -Method GET
```
