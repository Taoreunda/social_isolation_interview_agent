"""Operator commands for account bootstrap and session maintenance."""

from __future__ import annotations

import argparse
import getpass
from collections.abc import Callable, Sequence
from datetime import UTC, datetime, timedelta

from app_core.database import DatabaseConfigurationError, get_session_factory
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from auth.admin_service import (
    AccountAdministrationService,
    AccountConflict,
    BootstrapAdminExists,
)
from auth.policy import PolicyViolation
from auth.security import generate_password
from auth.service import AuthenticationService

SessionFactory = Callable[[], Session]
PasswordReader = Callable[[str], str]
Output = Callable[[str], None]


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _non_negative_int(raw: str) -> int:
    value = int(raw)
    if value < 0:
        raise argparse.ArgumentTypeError("must be zero or greater")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="backend/manage.py")
    commands = parser.add_subparsers(dest="command", required=True)
    bootstrap = commands.add_parser("bootstrap-admin")
    bootstrap.add_argument("--username", required=True)
    bootstrap.add_argument("--generate-password", action="store_true")
    cleanup = commands.add_parser("cleanup-sessions")
    cleanup.add_argument("--retention-days", type=_non_negative_int, default=7)
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    session_factory: SessionFactory | None = None,
    password_reader: PasswordReader | None = None,
    output: Output | None = None,
) -> int:
    args = build_parser().parse_args(argv)
    read_password = password_reader or getpass.getpass
    write = output or print

    if args.command == "cleanup-sessions":
        try:
            factory = session_factory or get_session_factory()
            with factory() as session:
                service = AuthenticationService(session, clock=_utc_now)
                deleted = service.cleanup_sessions(
                    retention=timedelta(days=args.retention_days)
                )
        except (DatabaseConfigurationError, SQLAlchemyError):
            write("데이터베이스를 사용할 수 없습니다.")
            return 2
        write(f"인증 세션 {deleted}개를 정리했습니다.")
        return 0

    if args.generate_password:
        password = generate_password()
    else:
        password = read_password("관리자 비밀번호: ")
        confirmation = read_password("관리자 비밀번호 확인: ")
        if password != confirmation:
            write("비밀번호가 일치하지 않습니다.")
            return 2

    try:
        factory = session_factory or get_session_factory()
        with factory() as session:
            service = AccountAdministrationService(session, clock=_utc_now)
            service.bootstrap_admin(username=args.username, password=password)
    except BootstrapAdminExists:
        write("초기 관리자가 이미 존재합니다.")
        return 2
    except (AccountConflict, PolicyViolation):
        write("관리자 계정을 생성할 수 없습니다.")
        return 2
    except (DatabaseConfigurationError, SQLAlchemyError):
        write("데이터베이스를 사용할 수 없습니다.")
        return 2

    write("관리자 계정을 생성했습니다.")
    if args.generate_password:
        write(f"초기 관리자 비밀번호: {password}")
    return 0
