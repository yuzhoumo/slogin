from __future__ import annotations

from pydantic import BaseModel


# Internal models (used for template rendering)

class AliasRow(BaseModel):
    """Formatted alias row passed to Jinja templates."""
    id: int
    email: str
    enabled: bool
    pinned: bool
    note: str
    creation_ts: float | None
    creation_date: str
    last_activity: str
    last_activity_ts: float | None
    last_activity_contact: str
    nb_forward: int
    nb_block: int
    nb_reply: int


# API request bodies

class NoteUpdate(BaseModel):
    note: str = ""


class PinUpdate(BaseModel):
    pinned: bool = False


class AliasCreate(BaseModel):
    random_uuid: bool | None = None
    prefix: str | None = None
    signed_suffix: str | None = None
    mailbox_ids: list[int] | None = None
    note: str | None = None


# API response bodies

class ToggleResponse(BaseModel):
    enabled: bool


class ErrorResponse(BaseModel):
    error: str


class AliasOptionsResponse(BaseModel):
    suffixes: list[dict[str, object]]
    can_create: bool
    default_mailbox_id: int | None = None
