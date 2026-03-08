"""Alias fetching and formatting logic."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from app.client import SimpleLoginClient
from app.models import AliasRow

log: logging.Logger = logging.getLogger("slogin")


async def fetch_alias_count(client: SimpleLoginClient) -> int:
    """Use the stats endpoint to determine total alias count."""
    resp = await client.get("/api/stats")
    resp.raise_for_status()
    data: dict[str, Any] = resp.json()
    count: int = data.get("nb_alias", 0)
    log.info("stats: %d aliases total", count)
    return count


async def fetch_page(
    client: SimpleLoginClient, page_id: int
) -> tuple[int, list[dict[str, Any]]]:
    """Fetch a single page of aliases."""
    page_start: float = time.monotonic()
    resp = await client.get("/api/v2/aliases", params={"page_id": page_id})
    elapsed: float = (time.monotonic() - page_start) * 1000
    data: dict[str, Any] = resp.json()
    batch: list[dict[str, Any]] = data.get("aliases", [])
    log.info(
        "page %d  %d %s  %d aliases  %.0fms",
        page_id,
        resp.status_code,
        resp.reason_phrase,
        len(batch),
        elapsed,
    )
    resp.raise_for_status()
    return page_id, batch


def format_timestamp(ts: float | None) -> str:
    """Format a unix timestamp for display, or em-dash if None."""
    if ts is None:
        return "—"
    dt: datetime = datetime.fromtimestamp(ts, tz=timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M")


def format_rows(aliases: list[dict[str, Any]]) -> list[AliasRow]:
    """Transform raw API alias dicts into typed AliasRow models."""
    rows: list[AliasRow] = []
    for a in aliases:
        last_activity: dict[str, Any] | None = a.get("latest_activity")
        last_ts: float | None = (
            last_activity["timestamp"] if last_activity else None
        )
        contact: dict[str, Any] | None = (
            last_activity.get("contact") if last_activity else None
        )
        contact_email: str = contact.get("email", "") if contact else ""
        rows.append(
            AliasRow(
                id=a["id"],
                email=a["email"],
                enabled=a["enabled"],
                pinned=a.get("pinned", False),
                note=a.get("note") or "",
                creation_ts=a.get("creation_timestamp"),
                creation_date=format_timestamp(a.get("creation_timestamp")),
                last_activity=format_timestamp(last_ts),
                last_activity_ts=last_ts,
                last_activity_contact=contact_email,
                nb_forward=a.get("nb_forward", 0),
                nb_block=a.get("nb_block", 0),
                nb_reply=a.get("nb_reply", 0),
            )
        )
    return rows
