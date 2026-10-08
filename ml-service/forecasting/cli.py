"""Command line interface for the Phase 4 forecasting subsystem.

    python -m forecasting train    [options]     # train + evaluate + save artefacts
    python -m forecasting generate [options]     # 1..7 day forecasts -> PostgreSQL

Both commands are also reachable through the backend npm scripts
(``npm run forecast:train`` / ``npm run forecast:generate``), which resolve the
ML service virtualenv for you.

Nothing here prints a credential: the database is described as ``user@host:port/db``.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .config import ML_SERVICE_DIR, load_database_config
from .data import ForecastDataAccess
from .pipeline import (
    DEFAULT_CANDIDATES,
    DEFAULT_HORIZONS,
    InsufficientHistoryError,
    SeriesSelector,
    default_model_version,
    generate_all,
    generate_series,
    run_training,
)
from .persist import list_artifacts


def _add_db_options(parser: argparse.ArgumentParser) -> None:
    group = parser.add_argument_group("database")
    group.add_argument("--db-host", help="PostgreSQL host (default: backend/.env DB_HOST)")
    group.add_argument("--db-port", type=int, help="PostgreSQL port (default: backend/.env DB_PORT)")
    group.add_argument("--db-user", help="PostgreSQL user (default: backend/.env DB_USER)")
    group.add_argument("--db-password", help="PostgreSQL password (default: backend/.env DB_PASSWORD)")
    group.add_argument("--db-name", help="PostgreSQL database (default: backend/.env DB_NAME)")


def _add_selector_options(parser: argparse.ArgumentParser) -> None:
    group = parser.add_argument_group("series selection")
    group.add_argument("--mandi", help="Mandi code or name fragment (case-insensitive)")
    group.add_argument("--commodity", help="Commodity code or name fragment (case-insensitive)")
    group.add_argument(
        "--fixture",
        action="store_true",
        help="Use the deterministic DEVELOPMENT FIXTURE (synthetic; refused in production)",
    )
    group.add_argument(
        "--no-sample",
        action="store_true",
        help="Exclude sample/synthetic rows from the history",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m forecasting",
        description="FASALYTICS Phase 4 mandi price forecasting",
    )
    parser.add_argument("--artifacts", help="Artefact root directory (default: ml-service/artifacts/forecasting)")
    sub = parser.add_subparsers(dest="command", required=True)

    train = sub.add_parser("train", help="Train and evaluate a model per series")
    _add_db_options(train)
    _add_selector_options(train)
    train.add_argument("--model-version", help="Model version string stamped on the artefact")
    train.add_argument("--horizons", default="1,2,3,4,5,6,7", help="Comma-separated horizons (max 7)")
    train.add_argument(
        "--candidates",
        default=",".join(DEFAULT_CANDIDATES),
        help=f"Comma-separated candidate models (default: {','.join(DEFAULT_CANDIDATES)})",
    )
    train.add_argument(
        "--allow-arrivals",
        action="store_true",
        help="Use arrival-quantity features when the series genuinely carries them",
    )
    train.add_argument("--json", action="store_true", help="Emit the full report as JSON")
    train.add_argument(
        "--generate",
        action="store_true",
        help="Also generate and persist forecasts immediately after training",
    )

    generate = sub.add_parser("generate", help="Generate 1..7 day forecasts and persist them")
    _add_db_options(generate)
    _add_selector_options(generate)
    generate.add_argument("--model-version", help="Model version to load (default: every trained artefact)")
    generate.add_argument(
        "--all",
        action="store_true",
        help="Generate for every artefact of the model version (default when --mandi/--commodity are omitted)",
    )
    generate.add_argument("--dry-run", action="store_true", help="Compute forecasts without writing to PostgreSQL")
    generate.add_argument("--json", action="store_true", help="Emit the full result as JSON")

    listing = sub.add_parser("list", help="List trained artefacts")
    listing.add_argument("--json", action="store_true")
    return parser


def _db_config(args):
    return load_database_config(
        host=getattr(args, "db_host", None),
        port=getattr(args, "db_port", None),
        user=getattr(args, "db_user", None),
        password=getattr(args, "db_password", None),
        database=getattr(args, "db_name", None),
    )


def _selector(args) -> SeriesSelector:
    return SeriesSelector(
        mandi=getattr(args, "mandi", None),
        commodity=getattr(args, "commodity", None),
        use_fixture=bool(getattr(args, "fixture", False)),
        include_sample=not bool(getattr(args, "no_sample", False)),
    )


def _parse_horizons(raw: str) -> tuple[int, ...]:
    try:
        horizons = tuple(sorted({int(part) for part in str(raw).split(",") if part.strip()}))
    except ValueError as exc:
        raise SystemExit(f"--horizons must be comma-separated whole numbers: {exc}") from exc
    if not horizons:
        raise SystemExit("--horizons must contain at least one horizon")
    if min(horizons) < 1 or max(horizons) > 7:
        raise SystemExit("Phase 4 horizons must be between 1 and 7 inclusive")
    return horizons


def command_train(args) -> int:
    started = time.time()
    db_config = _db_config(args)
    selector = _selector(args)
    horizons = _parse_horizons(args.horizons)
    candidates = tuple(part.strip() for part in str(args.candidates).split(",") if part.strip())
    model_version = args.model_version or default_model_version(fixture=selector.use_fixture)
    artifact_root = Path(args.artifacts) if args.artifacts else None

    print(f"[forecast:train] database {db_config.describe()}")
    print(f"[forecast:train] model version '{model_version}', horizons {list(horizons)}")
    if selector.use_fixture:
        print("[forecast:train] NOTE: using the DEVELOPMENT FIXTURE (synthetic data, not real prices)")

    with ForecastDataAccess(db_config) as access:
        try:
            outcome = run_training(
                access=access,
                selector=selector,
                model_version=model_version,
                db_config=db_config,
                artifact_root=artifact_root,
                horizons=horizons,
                candidates=candidates,
                allow_arrivals=bool(args.allow_arrivals),
            )
        except InsufficientHistoryError as exc:
            print(f"[forecast:train] {exc.code}: {exc}", file=sys.stderr)
            if exc.code == "NO_DATA":
                print(
                    "[forecast:train] Seed the development fixture with --fixture to exercise the pipeline.",
                    file=sys.stderr,
                )
            return 2

    if args.json:
        print(json.dumps(outcome.to_dict(), indent=2, default=str))
    else:
        if outcome.fixture:
            print(f"[forecast:train] fixture: {json.dumps(outcome.fixture)}")
        for report in outcome.trained:
            selection = report["selection"]
            metrics_by_model = selection.get("mean_validation_mae", {})
            chosen = selection.get("selected")
            print(
                f"[forecast:train] {report['series']}: {report['observations']} observations, "
                f"model={report['model_name']}, validation MAE={metrics_by_model.get(chosen)}"
            )
            for metric in report["test_metrics"]:
                if metric["model"] == report["model_name"]:
                    print(
                        f"    test h={metric['horizon']}: MAE={metric['mae']} RMSE={metric['rmse']} "
                        f"MAPE={metric['mape']} dir={metric['directional_accuracy']}"
                    )
            print(f"    artefact: {report['artifact']}")
        for skipped in outcome.skipped:
            print(f"[forecast:train] skipped {skipped['series']}: {skipped['reason']}")

    print(f"[forecast:train] done in {round(time.time() - started, 1)}s "
          f"({len(outcome.trained)} trained, {len(outcome.skipped)} skipped)")

    if args.generate:
        return command_generate(args, forced_version=model_version, inherit_selector=True)

    return 0 if outcome.trained else 1


def command_generate(args, *, forced_version: str | None = None, inherit_selector: bool = False) -> int:
    db_config = _db_config(args)
    selector = _selector(args)
    artifact_root = Path(args.artifacts) if args.artifacts else None
    model_version = forced_version or args.model_version

    with ForecastDataAccess(db_config) as access:
        if model_version:
            if selector.mandi or selector.commodity:
                results = [
                    generate_series(
                        access,
                        mandi_code=entry["mandi_code"],
                        commodity_code=entry["commodity_code"],
                        model_version=model_version,
                        artifact_root=artifact_root,
                        persist=not bool(getattr(args, "dry_run", False)),
                    )
                    for entry in list_artifacts(root=artifact_root)
                    if entry.get("model_version") == model_version
                    and selector.matches(entry.get("mandi_code", ""), entry.get("commodity_code", ""))
                ]
            else:
                results = generate_all(
                    access, model_version=model_version, selector=None, artifact_root=artifact_root
                )
        else:
            versions = sorted({entry["model_version"] for entry in list_artifacts(root=artifact_root)})
            if not versions:
                print(
                    "[forecast:generate] no trained artefacts found; run `npm run forecast:train` first",
                    file=sys.stderr,
                )
                return 2
            results = []
            for version in versions:
                results.extend(generate_all(access, model_version=version, selector=selector, artifact_root=artifact_root))

    if args.json:
        print(json.dumps(results, indent=2, default=str))
        return 0 if any(not r.get("skipped") for r in results) else 1

    written = 0
    for result in results:
        if result.get("skipped"):
            print(f"[forecast:generate] skipped {result['series']}: {result['reason']}")
            continue
        written += result["rows_written"]
        print(
            f"[forecast:generate] {result['series']}: {result['rows_written']} rows, "
            f"model={result['model_name']} ({result['model_version']}), "
            f"observed {result['last_observed_date']} @ {result['last_observed_price']}"
            + ("  [FIXTURE DATA]" if result["is_sample_data"] else "")
        )
        for forecast in result["forecasts"]:
            print(
                f"    +{forecast['horizon_days']}d {forecast['date']}: "
                f"{forecast['predicted_price']} ({forecast['lower_bound']} - {forecast['upper_bound']}) "
                f"confidence {forecast['confidence']}%"
            )
    print(f"[forecast:generate] persisted {written} forecast row(s)")
    return 0 if written or results else 1


def command_list(args) -> int:
    artifacts = list_artifacts(root=Path(args.artifacts) if args.artifacts else None)
    if args.json:
        print(json.dumps(artifacts, indent=2))
        return 0
    if not artifacts:
        print("[forecast:list] no trained artefacts")
        return 0
    for entry in artifacts:
        print(
            f"{entry['commodity_code']:>10} @ {entry['mandi_code']:<16} "
            f"model={entry['model_name']:<20} version={entry['model_version']:<28} "
            f"trained_to={entry['training_data_end_date']} source={entry['data_source']}"
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "train":
        return command_train(args)
    if args.command == "generate":
        return command_generate(args)
    if args.command == "list":
        return command_list(args)
    parser.error(f"unknown command {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
