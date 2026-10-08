# FASALYTICS location reference data

Source: **Local Government Directory (LGD), Ministry of Panchayati Raj, Government of India**.
Official directory: https://lgdirectory.gov.in/downloadDirectory.do
Public CSV archive: https://ramseraph.github.io/opendata/lgd/
Government Open Data License — India: https://data.gov.in/government-open-data-license-india

Snapshot: **30 April 2026**. These are dated reference options, not a live claim about administrative boundaries. The app is not an official government product. The directory is provided without a completeness warranty; source errors and later administrative changes may exist.

The 36 state/UT entries and 784 districts use LGD parent codes. Village records are joined by district and state codes. Town names come from urban-local-body coverage records joined by district code, not inferred from similarly named villages. Duplicate names within a district are collapsed because existing farmer profiles store names, not LGD codes. A town spanning districts may appear in each mapped district. Original English spellings are retained; UI instructions are translated separately.

`src/data/location-index.json` contains the small state/district index. Each `<district-code>.json` file contains only that district's village/town names and parent codes. The browser lazily loads this file from the app's own origin. The full directory is not bundled into the JavaScript entry chunk, and no farmer details are sent to an external location service.

`manifest.json` records input checksums, row counts and exclusions. There are 620,164 distinct district/name options. 173 source rows with malformed/unsupported characters or names outside the existing 2–100 character profile limit were excluded; zero rows were excluded for an unknown parent. Empty/unknown results are never replaced with invented locations. Existing saved address names remain visible and may be retained unchanged during profile editing. New village/town entries must match the selected district's list; village/town remains optional if absent from this snapshot.

## Reproduce the static assets

Download these data archives into `frontend/.location-source/` (ignored), then extract only the named CSV members using a 7z-compatible tool such as Windows `tar.exe`:

| Archive | Member |
| --- | --- |
| https://github.com/ramSeraph/opendata/releases/download/lgd-archive-extra1/states.Apr2026.7z | `states.30Apr2026.csv` |
| https://github.com/ramSeraph/opendata/releases/download/lgd-archive-extra1/districts.Apr2026.7z | `districts.30Apr2026.csv` |
| https://github.com/ramSeraph/opendata/releases/download/lgd-latest/villages.30Apr2026.csv.7z | `villages.30Apr2026.csv` |
| https://github.com/ramSeraph/opendata/releases/download/lgd-archive-extra1/statewise_ulbs_coverage.Apr2026.7z | `statewise_ulbs_coverage.30Apr2026.csv` |

From `frontend`, run `python scripts/build-location-data.py .location-source`. This uses Python's standard library only, writes frontend JSON assets, and never connects to PostgreSQL or the market-data pipeline. A future snapshot update must regenerate the index and all district files together and review source exclusions before publishing.
