"""Trains the Phase 4 forecasting models on the SYNTHETIC history CSV (no database access).

    venv\\Scripts\\python.exe train_synthetic_csv.py [--csv PATH] [--limit N] [--only MARKET/COMMODITY]

The CSV comes from `npm run synthetic:history` (backend/data/synthetic). It is not real market
data: every row must carry source MOCK_PROVIDER and is_sample_data=true, otherwise this script
refuses to run. Artefacts are written under artifacts/synthetic_csv/ (git-ignored) and recorded
with data_source FIXTURE, so the forecast API treats them as synthetic. Metrics produced here
describe how well the models recover a *synthetic* price process, not real-world accuracy.
"""

from __future__ import annotations

import os

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import argparse
import csv
import datetime as dt
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

from forecasting.data import Observation, PriceSeries
from forecasting.pipeline import DEFAULT_CANDIDATES, DEFAULT_HORIZONS, InsufficientHistoryError, train_series

ML_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_DIR = ML_DIR.parent / "backend" / "data" / "synthetic"
DEFAULT_ARTIFACT_ROOT = ML_DIR / "artifacts" / "synthetic_csv"
DISCLAIMER = (
    "Trained on SYNTHETIC data (source MOCK_PROVIDER). Metrics measure recovery of a generated "
    "price process, not accuracy on real mandi prices."
)


def load_series_from_csv(path: Path, years: float | None = None) -> list[PriceSeries]:
    """One PriceSeries per (market, commodity); refuses anything that is not flagged synthetic.

    `years` keeps only the most recent N years of the file (counted back from its latest date).
    """
    rows_all: list[dict] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["source"] != "MOCK_PROVIDER" or row["is_sample_data"].lower() != "true":
                raise SystemExit(f"refusing to train: row {row['source_record_key']} is not flagged synthetic")
            rows_all.append(row)
    if years:
        last = dt.date.fromisoformat(max(r["price_date"] for r in rows_all))
        first = (last - dt.timedelta(days=round(365 * years) - 1)).isoformat()
        rows_all = [r for r in rows_all if r["price_date"] >= first]
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows_all:
        grouped[(row["mandi_code"], row["commodity_code"])].append(row)

    series_list: list[PriceSeries] = []
    for index, ((mandi_code, commodity_code), rows) in enumerate(sorted(grouped.items()), start=1):
        rows.sort(key=lambda r: r["price_date"])
        observations = [
            Observation(
                price_date=dt.date.fromisoformat(r["price_date"]),
                modal_price=float(r["modal_price"]),
                min_price=float(r["min_price"]),
                max_price=float(r["max_price"]),
                arrivals_quantity=float(r["arrivals_quantity"]) if r["arrivals_quantity"] else None,
                arrival_unit=r["arrival_unit"] or None,
                source=r["source"],
                is_sample_data=True,
            )
            for r in rows
        ]
        series_list.append(PriceSeries(
            mandi_id=index, commodity_id=index, mandi_code=mandi_code, mandi_name=rows[0]["mandi_name"],
            commodity_code=commodity_code, commodity_name=rows[0]["commodity_name"], observations=observations,
        ))
    return series_list


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--csv", type=Path, help="synthetic history CSV (default: newest in backend/data/synthetic)")
    parser.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    parser.add_argument("--limit", type=int, help="train only the first N series")
    parser.add_argument("--only", help="train one series, e.g. MAHARASHTRA__NASHIK__NASHIK/ONION")
    parser.add_argument("--shard", help="K/N: train every N-th series starting at K (for parallel runs), e.g. 0/6")
    parser.add_argument("--years", type=float, default=2.0, help="use only the most recent N years of the file (default 2; 0 = all)")
    parser.add_argument("--allow-arrivals", action="store_true", help="let the models use arrival quantities")
    args = parser.parse_args()

    csv_path = args.csv or max(DEFAULT_DATA_DIR.glob("synthetic_mandi_history_*.csv"), key=lambda p: p.stat().st_mtime, default=None)
    if csv_path is None or not csv_path.exists():
        raise SystemExit("no synthetic history CSV found; run `npm run synthetic:history` in backend first")

    all_series = load_series_from_csv(csv_path, args.years or None)
    if args.only:
        all_series = [s for s in all_series if f"{s.mandi_code}/{s.commodity_code}" == args.only]
    if args.limit:
        all_series = all_series[: args.limit]
    shard = ""
    if args.shard:
        k, n = (int(x) for x in args.shard.split("/"))
        all_series = all_series[k::n]
        shard = f"_shard{k}of{n}"
    window = f"{args.years:g}y" if args.years else "all"
    version = f"phase4-synthetic-csv-{window}-v1-{dt.datetime.now(dt.timezone.utc):%Y%m%d}"
    print(f"[train] {csv_path.name}: {len(all_series)} series, model_version={version}")
    print(f"[train] {DISCLAIMER}")

    reports, skipped = [], []
    started = time.time()
    for i, series in enumerate(all_series, start=1):
        key = f"{series.mandi_code}/{series.commodity_code}"
        t0 = time.time()
        print(f"[train] ({i}/{len(all_series)}) {key}: {series.size} observations", flush=True)
        try:
            _artifact, _models, report = train_series(
                series, model_version=version, horizons=DEFAULT_HORIZONS, candidates=DEFAULT_CANDIDATES,
                allow_arrivals=args.allow_arrivals, data_source="FIXTURE", artifact_root=args.artifact_root,
            )
            reports.append(report)
            print(f"[train]   done in {time.time() - t0:.0f}s", flush=True)
        except InsufficientHistoryError as exc:
            skipped.append({"series": key, "reason": str(exc)})
            print(f"[train]   skipped: {exc}")

    summary = {
        "DISCLAIMER": DISCLAIMER, "model_version": version, "csv": csv_path.name, "window_years": args.years or None,
        "trained": len(reports), "skipped": skipped, "seconds": round(time.time() - started),
        "reports": reports,
    }
    out = args.artifact_root / f"training_summary_{version}{shard}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    print(f"[train] trained={len(reports)} skipped={len(skipped)} in {summary['seconds']}s -> {out}")
    return 0 if reports else 1


if __name__ == "__main__":
    sys.exit(main())
