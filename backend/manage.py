"""Repository-local entry point for privileged operator commands."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from auth.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
