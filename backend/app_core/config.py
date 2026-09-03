"""Configuration helpers — .env + os.environ based."""

from __future__ import annotations

import os
from typing import Any, Optional, Sequence

from dotenv import load_dotenv

_BOOTSTRAPPED = False


def get_config_value(
    key: str,
    default: Any = None,
    **_kwargs: Any,
) -> Any:
    """Fetch a configuration value from environment variables."""
    value = os.environ.get(key)
    if value is not None:
        return value
    return default


def get_bool_config(
    key: str,
    default: bool = False,
    **_kwargs: Any,
) -> bool:
    """Return a truthy configuration flag."""
    value = os.environ.get(key)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_int_config(
    key: str,
    default: int = 0,
    **_kwargs: Any,
) -> int:
    """Return an integer configuration value."""
    value = os.environ.get(key)
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def get_list_config(
    key: str,
    default: Optional[Sequence[str]] = None,
    **_kwargs: Any,
) -> list[str]:
    """Return a list of values from configuration."""
    value = os.environ.get(key)
    if value is None:
        return list(default or [])
    parts = [s.strip() for s in value.split(",")]
    return [s for s in parts if s]


def apply_langsmith_settings() -> None:
    """Propagate LangSmith-related flags to LangChain environment variables."""
    tracing_enabled = get_bool_config("LANGSMITH_TRACING", default=False)
    if tracing_enabled:
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
    else:
        os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")

    project = get_config_value("LANGSMITH_PROJECT")
    if project:
        os.environ.setdefault("LANGCHAIN_PROJECT", str(project))

    api_key = get_config_value("LANGSMITH_API_KEY")
    if api_key:
        os.environ.setdefault("LANGCHAIN_API_KEY", str(api_key))


def bootstrap() -> None:
    """Load .env file and apply runtime flags."""
    global _BOOTSTRAPPED
    if _BOOTSTRAPPED:
        return

    load_dotenv()
    apply_langsmith_settings()
    _BOOTSTRAPPED = True


__all__ = [
    "apply_langsmith_settings",
    "bootstrap",
    "get_bool_config",
    "get_config_value",
    "get_int_config",
    "get_list_config",
]
