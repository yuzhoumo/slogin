"""JSON API proxy routes for alias management."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.client import SimpleLoginClient
from app.models import AliasCreate, NoteUpdate, PinUpdate
from app.services import render_alias_row

log: logging.Logger = logging.getLogger("slogin")
router: APIRouter = APIRouter(prefix="/api")


def _get_client(request: Request) -> SimpleLoginClient:
    client: SimpleLoginClient = request.app.state.client
    return client


@router.post("/toggle/{alias_id}")
async def toggle_alias(alias_id: int, request: Request) -> JSONResponse:
    """Proxy toggle request to SimpleLogin API."""
    log.info("POST /api/toggle/%d", alias_id)
    client: SimpleLoginClient = _get_client(request)
    try:
        resp = await client.post(f"/api/aliases/{alias_id}/toggle")
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        return JSONResponse(data)
    except Exception as e:
        log.error("toggle failed for alias %d: %s", alias_id, e)
        return JSONResponse({"error": str(e)}, status_code=502)


@router.delete("/alias/{alias_id}")
async def delete_alias(alias_id: int, request: Request) -> JSONResponse:
    """Delete an alias."""
    log.info("DELETE /api/alias/%d", alias_id)
    client: SimpleLoginClient = _get_client(request)
    try:
        resp = await client.delete(f"/api/aliases/{alias_id}")
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        return JSONResponse(data)
    except Exception as e:
        log.error("delete failed for alias %d: %s", alias_id, e)
        return JSONResponse({"error": str(e)}, status_code=502)


@router.patch("/alias/{alias_id}/note")
async def update_alias_note(
    alias_id: int, body: NoteUpdate, request: Request
) -> JSONResponse:
    """Update the note/description of an alias."""
    client: SimpleLoginClient = _get_client(request)
    resp = await client.patch(
        f"/api/aliases/{alias_id}", json_body={"note": body.note}
    )
    return JSONResponse(resp.json(), status_code=resp.status_code)


@router.patch("/alias/{alias_id}/pin")
async def toggle_pin(
    alias_id: int, body: PinUpdate, request: Request
) -> JSONResponse:
    """Toggle pinned state of an alias."""
    log.info("PATCH /api/alias/%d/pin pinned=%s", alias_id, body.pinned)
    client: SimpleLoginClient = _get_client(request)
    resp = await client.patch(
        f"/api/aliases/{alias_id}", json_body={"pinned": body.pinned}
    )
    return JSONResponse(resp.json(), status_code=resp.status_code)


@router.get("/alias/options")
async def alias_options(request: Request) -> JSONResponse:
    """Get alias creation options (suffixes, mailboxes)."""
    log.info("GET /api/alias/options")
    client: SimpleLoginClient = _get_client(request)

    opts_resp = await client.get("/api/v5/alias/options")
    opts_resp.raise_for_status()
    mb_resp = await client.get("/api/v2/mailboxes")
    mb_resp.raise_for_status()

    mailboxes: list[dict[str, Any]] = mb_resp.json().get("mailboxes", [])
    default_mb: dict[str, Any] | None = next(
        (m for m in mailboxes if m.get("default")),
        mailboxes[0] if mailboxes else None,
    )

    result: dict[str, Any] = opts_resp.json()
    result["default_mailbox_id"] = default_mb["id"] if default_mb else None
    return JSONResponse(result)


@router.post("/alias/create")
async def create_alias(body: AliasCreate, request: Request) -> JSONResponse:
    """Create a new alias. Handles both random and custom creation."""
    log.info("POST /api/alias/create %s", body.model_dump())
    client: SimpleLoginClient = _get_client(request)

    if body.random_uuid:
        resp = await client.post(
            "/api/alias/random/new", params={"mode": "uuid"}
        )
    else:
        json_body: dict[str, Any] = {
            "alias_prefix": body.prefix,
            "signed_suffix": body.signed_suffix,
            "mailbox_ids": body.mailbox_ids,
        }
        if body.note:
            json_body["note"] = body.note
        resp = await client.post("/api/v3/alias/custom/new", json_body=json_body)

    data: dict[str, Any] = resp.json()
    if resp.status_code < 400:
        data["row_html"] = render_alias_row(data)
    return JSONResponse(data, status_code=resp.status_code)
