"""Authoritative project paths, derived once from the repo layout.

All Python code lives under ``backend/``; runtime data and config live at the
repo root. Modules import these constants instead of independently re-deriving
the root with a hardcoded ``parents[N]`` depth (which silently breaks when a
file moves).
"""

from __future__ import annotations

from pathlib import Path

# backend/app_core/paths.py → parents[1] == backend/, parents[2] == repo root
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent

# Runtime data / config locations (cwd-independent)
FLOW_CONFIG_PATH = REPO_ROOT / "interview_flow.json"

__all__ = ["BACKEND_DIR", "REPO_ROOT", "FLOW_CONFIG_PATH"]
