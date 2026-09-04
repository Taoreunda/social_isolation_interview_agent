"""Public authentication request and response schemas."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict

from auth.policy import Role


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class ApiSchema(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class LoginRequest(ApiSchema):
    username: str
    password: str
    remember: bool = False


class CurrentUserResponse(ApiSchema):
    id: UUID
    username: str
    role: Role
    participant_code: str | None


class ChangePasswordRequest(ApiSchema):
    current_password: str
    new_password: str
