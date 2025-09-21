"""Simple administrator authentication utilities for Streamlit pages."""

from __future__ import annotations

from typing import Any, Dict, Optional

from collections.abc import Mapping

from .config import StreamlitSecretNotFoundError, get_config_value

try:  # pragma: no cover - optional when Streamlit isn't present
    import streamlit as st
except Exception:  # pragma: no cover
    st = None  # type: ignore

_SESSION_KEY = "admin_auth_state"


def _get_streamlit():  # pragma: no cover - isolation for tests
    return st


def _get_admin_credentials() -> Optional[Dict[str, str]]:
    st_module = _get_streamlit()
    username = None
    password = None

    if st_module is not None:
        try:
            secrets = st_module.secrets
        except StreamlitSecretNotFoundError:
            secrets = None

        if secrets is not None and "admin" in secrets:
            admin_section = secrets["admin"]
            if isinstance(admin_section, Mapping):
                admin_dict = dict(admin_section)
            elif hasattr(admin_section, "keys"):
                admin_dict = {key: admin_section[key] for key in admin_section.keys()}
            else:
                admin_dict = {}
            username = admin_dict.get("username") or admin_dict.get("email")
            password = admin_dict.get("password")

    username = username or (
        get_config_value("ADMIN_USERNAME", sections=("admin", "env", "app"))
        or get_config_value("username", sections=("admin", "env", "app"))
        or get_config_value("ADMIN_EMAIL", sections=("admin", "env", "app"))
        or get_config_value("admin_username", sections=("admin", "env", "app"))
    )
    password = password or (
        get_config_value("ADMIN_PASSWORD", sections=("admin", "env", "app"))
        or get_config_value("password", sections=("admin", "env", "app"))
        or get_config_value("admin_password", sections=("admin", "env", "app"))
        or get_config_value("ADMIN_PASS", sections=("admin", "env", "app"))
    )
    if not username or not password:
        return None
    return {"username": username, "password": password}


def _init_session_state() -> Dict[str, Any]:
    st_module = _get_streamlit()
    if st_module is None:
        return {"logged_in": True, "username": "test"}
    return st_module.session_state.setdefault(_SESSION_KEY, {"logged_in": False, "username": None})


def _perform_logout() -> None:
    st_module = _get_streamlit()
    if st_module is None:
        return
    if _SESSION_KEY in st_module.session_state:
        del st_module.session_state[_SESSION_KEY]
    st_module.rerun()


def require_admin_login(context_key: str) -> bool:
    """Render a username/password form until the admin logs in."""

    st_module = _get_streamlit()
    if st_module is None:  # pragma: no cover - non-Streamlit usage
        return True

    credentials = _get_admin_credentials()
    if credentials is None:
        st_module.error(
            "관리자 아이디와 비밀번호가 설정되어 있지 않습니다. "
            "`.env` 또는 `.streamlit/secrets.toml`에 `[admin].username`과 `[admin].password` (또는 `ADMIN_USERNAME`/`ADMIN_PASSWORD`)을 설정해주세요."
        )
        return False

    session_state = _init_session_state()
    expected_username = credentials["username"]
    expected_password = credentials["password"]

    if session_state.get("logged_in") and session_state.get("username") == expected_username:
        return True

    login_container = st_module.empty()
    with login_container.form(key=f"admin-login-form-{context_key}"):
        st_module.subheader("🔐 관리자 로그인")
        username_input = st_module.text_input("아이디", value="", key=f"username-{context_key}")
        password_input = st_module.text_input("비밀번호", value="", type="password", key=f"password-{context_key}")
        submitted = st_module.form_submit_button("로그인")

    if submitted:
        if username_input == expected_username and password_input == expected_password:
            st_module.session_state[_SESSION_KEY] = {
                "logged_in": True,
                "username": expected_username,
            }
            st_module.success("로그인되었습니다.")
            st_module.rerun()
        else:
            st_module.error("아이디 또는 비밀번호가 올바르지 않습니다.")

    return False


def render_user_badge(context_key: str, *, location: str = "sidebar") -> None:
    st_module = _get_streamlit()
    if st_module is None:
        return

    session_state = st_module.session_state.get(_SESSION_KEY)
    if not session_state or not session_state.get("logged_in"):
        return

    username = session_state.get("username", "관리자")

    if location == "sidebar":
        if not st_module.session_state.get("_sidebar_layout_injected", False):
            st_module.sidebar.markdown(
                """
                <style>
                section[data-testid="stSidebar"] > div:first-child {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                }
                .sidebar-spacer {
                    flex: 1 1 auto;
                }
                .sidebar-footer {
                    margin-top: auto;
                    padding-top: 1rem;
                    border-top: 1px solid var(--secondary-background-color);
                    background-color: var(--background-color);
                }
                .sidebar-footer small {
                    color: var(--text-color);
                }
                </style>
                """,
                unsafe_allow_html=True,
            )
            st_module.session_state["_sidebar_layout_injected"] = True

        st_module.sidebar.markdown('<div class="sidebar-spacer"></div>', unsafe_allow_html=True)
        footer = st_module.sidebar.container()
        footer.markdown(
            f"""
            <div class="sidebar-footer">
              <strong>👤 관리자</strong><br>
              <small>{username}</small>
            </div>
            """,
            unsafe_allow_html=True,
        )
        if footer.button("로그아웃", key=f"logout-btn-{context_key}", use_container_width=True):
            _perform_logout()
        return

    target = st_module
    target.markdown(f"**👤 관리자** {username}")
    if target.button("로그아웃", key=f"logout-btn-{context_key}"):
        _perform_logout()


__all__ = ["render_user_badge", "require_admin_login"]
