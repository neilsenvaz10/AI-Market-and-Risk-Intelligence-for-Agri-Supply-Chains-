"""Enables ``python -m forecasting ...`` from the ml-service directory."""

from __future__ import annotations

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
