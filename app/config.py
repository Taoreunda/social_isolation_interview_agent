"""Configuration helpers for Streamlit and background services."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional, Sequence
from collections.abc import Mapping

from dotenv import load_dotenv

_BOOTSTRAPPED = False


try:  # pragma: no cover - compatibility with older Streamlit
    from streamlit.runtime.secrets import StreamlitSecretNotFoundError
except Exception:  # pragma: no cover
    class StreamlitSecretNotFoundError(Exception):
        """Fallback secret error when Streamlit is unavailable."""

try:  # Python 3.11+
    import tomllib as _toml
except Exception:  # pragma: no cover - Python <3.11
    try:
        import tomli as _toml  # type: ignore
    except Exception:  # pragma: no cover - minimal fallback
        _toml = None


def _get_streamlit():
    try:
        import streamlit as st  # type: ignore
    except Exception:  # pragma: no cover - optional dependency when running tests
        return None
    return st


def _get_secrets():
    st = _get_streamlit()
    if st is None:
        return _load_raw_secrets()

    try:
        return st.secrets
    except StreamlitSecretNotFoundError:
        return _load_raw_secrets()


def _load_raw_secrets():
    if _toml is None:  # pragma: no cover - toml parser unavailable
        return None

    candidate_paths = [
        Path.cwd() / ".streamlit" / "secrets.toml",
        Path.home() / ".streamlit" / "secrets.toml",
    ]

    for path in candidate_paths:
        if path.is_file():
            try:
                with path.open("rb") as handle:
                    return _toml.load(handle)
            except Exception:  # pragma: no cover - ignore malformed
                continue
    return None


def _coerce_to_str(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _lookup_in_secrets(key: str, sections: Sequence[str]) -> Any:
    secrets = _get_secrets()
    if secrets is None:  # pragma: no cover - streamlit unavailable in some tests
        return None

    try:
        if key in secrets:
            value = secrets[key]
            if isinstance(value, Mapping):
                return dict(value)
            return value
    except Exception:  # pragma: no cover - Secrets may raise when missing
        pass

    for section in sections:
        try:
            if section in secrets:
                section_data = secrets[section]
                if isinstance(section_data, Mapping):
                    section_dict = dict(section_data)
                else:
                    section_dict = section_data
                if isinstance(section_dict, Mapping) and key in section_dict:
                    return section_dict[key]
        except Exception:  # pragma: no cover - tolerant against Secrets access errors
            continue
    return None


def sync_env_from_secrets(section: str = "env") -> None:
    """Mirror Streamlit secrets into environment variables for SDK compatibility."""

    secrets = _get_secrets()
    if secrets is None:
        return

    if section not in secrets:
        return

    section_data = secrets[section]
    if not isinstance(section_data, dict):
        return

    for key, value in section_data.items():
        if key in os.environ:
            continue
        os.environ[key] = _coerce_to_str(value)


def get_config_value(
    key: str,
    default: Any = None,
    *,
    sections: Sequence[str] = ("env", "app"),
) -> Any:
    """Fetch a configuration value from env vars or Streamlit secrets."""

    secrets_value = _lookup_in_secrets(key, sections)
    if secrets_value is not None:
        return secrets_value

    return default


def get_bool_config(
    key: str,
    default: bool = False,
    *,
    sections: Sequence[str] = ("env", "app"),
) -> bool:
    """Return a truthy configuration flag."""

    value = get_config_value(key, default=None, sections=sections)
    if value is None:
        return default

    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return bool(value)

    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}

    return default


def get_int_config(
    key: str,
    default: int = 0,
    *,
    sections: Sequence[str] = ("env", "app"),
) -> int:
    """Return an integer configuration value."""

    value = get_config_value(key, default=None, sections=sections)
    if value is None:
        return default

    try:
        return int(value)
    except (TypeError, ValueError):  # pragma: no cover - guardrail
        return default


def get_list_config(
    key: str,
    default: Optional[Sequence[str]] = None,
    *,
    sections: Sequence[str] = ("env", "app"),
) -> list[str]:
    """Return a list of values from configuration."""

    value = get_config_value(key, default=None, sections=sections)
    if value is None:
        return list(default or [])

    if isinstance(value, str):
        parts = [segment.strip() for segment in value.split(",")]
        return [segment for segment in parts if segment]

    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]

    return list(default or [])


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
    """Load .env files, mirror Streamlit secrets, and apply runtime flags."""

    global _BOOTSTRAPPED
    if _BOOTSTRAPPED:
        return

    load_dotenv()  # load local .env for CLI and tests
    sync_env_from_secrets()
    apply_langsmith_settings()
    _BOOTSTRAPPED = True


__all__ = [
    "StreamlitSecretNotFoundError",
    "apply_langsmith_settings",
    "bootstrap",
    "get_bool_config",
    "get_config_value",
    "get_int_config",
    "get_list_config",
    "sync_env_from_secrets",
]
