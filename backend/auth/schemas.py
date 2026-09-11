"""Public authentication request and response schemas."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator

from auth.policy import AccountStatus, Role


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


class CreateParticipantRequest(ApiSchema):
    username: str | None = None
    participant_code: str | None = None
    password: str | None = None
    generate_password: bool = False

    @model_validator(mode="after")
    def require_one_password_source(self) -> CreateParticipantRequest:
        if self.generate_password == (self.password is not None):
            raise ValueError("Provide a password or request generation")
        return self


class ParticipantResponse(ApiSchema):
    id: UUID
    username: str
    participant_code: str
    status: AccountStatus
    interview_status: Literal[
        "not_started", "active", "completed", "archived"
    ] = "not_started"


class ParticipantCredentialResponse(ApiSchema):
    participant: ParticipantResponse
    assigned_password: str | None


class ResetParticipantPasswordRequest(ApiSchema):
    password: str | None = None
    generate_password: bool = False

    @model_validator(mode="after")
    def require_one_password_source(self) -> ResetParticipantPasswordRequest:
        if self.generate_password == (self.password is not None):
            raise ValueError("Provide a password or request generation")
        return self


class PasswordAssignmentResponse(ApiSchema):
    assigned_password: str | None
