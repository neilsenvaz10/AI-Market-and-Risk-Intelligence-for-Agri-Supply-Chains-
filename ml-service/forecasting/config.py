"""Configuration for the Phase 4 forecasting subsystem.

Connection settings are read from the backend's ``.env`` (the single source of
truth for the Phase 3 database), so the forecasting commands talk to exactly the
same PostgreSQL database as the Express backend. Explicit CLI flags override the
file; nothing here is ever logged with its password.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Optional

# config.py -> forecasting/ -> ml-service/ -> <repo root>
ML_SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_SERVICE_DIR.parent
BACKEND_ENV = REPO_ROOT / "backend" / ".env"
DEFAULT_ARTIFACT_DIR = ML_SERVICE_DIR / "artifacts" / "forecasting"


@dataclass(frozen=True)
class DatabaseConfig:
    host: str = "localhost"
    port: int = 5433
    user: str = "postgres"
    password: str = ""
    database: str = "fasalytics"
    connection_string: Optional[str] = None

    def as_dsn_kwargs(self) -> dict:
        """Keyword arguments for ``psycopg2.connect`` (never rendered to a string)."""
        if self.connection_string:
            return {"dsn": self.connection_string}
        return {
            "host": self.host,
            "port": self.port,
            "user": self.user,
            "password": self.password,
            "dbname": self.database,
        }

    def describe(self) -> str:
        """Safe description for logs — deliberately excludes the password."""
        if self.connection_string:
            return "DATABASE_URL (redacted)"
        return f"{self.user}@{self.host}:{self.port}/{self.database}"


def _parse_env_file(path: Path) -> dict:
    """Minimal .env reader (KEY=VALUE, ``#`` comments, optional quotes)."""
    values: dict = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def load_database_config(env_file: Path | None = None, **overrides) -> DatabaseConfig:
    """Reads the DB settings used by the backend, then applies explicit overrides.

    Precedence: explicit override > process environment > ``backend/.env`` > default.
    """
    file_values = _parse_env_file(env_file or BACKEND_ENV)
    merged = {**file_values, **{k: v for k, v in os.environ.items() if v}}

    def pick(name: str, default: str) -> str:
        return str(merged.get(name) or default)

    config = DatabaseConfig(
        host=pick("DB_HOST", "localhost"),
        port=int(pick("DB_PORT", "5433") or 5433),
        user=pick("DB_USER", "postgres"),
        password=pick("DB_PASSWORD", ""),
        database=pick("DB_NAME", "fasalytics"),
        connection_string=(merged.get("DATABASE_URL") or None),
    )
    if overrides:
        clean = {k: v for k, v in overrides.items() if v is not None}
        config = replace(config, **clean)
    return config


def environment_name() -> str:
    return os.environ.get("NODE_ENV", "development").lower()


def is_production() -> bool:
    return environment_name() == "production"
