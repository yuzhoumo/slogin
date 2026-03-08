"""HTML page routes."""

from __future__ import annotations

import asyncio
import logging
import math
import time
from collections.abc import AsyncGenerator
from typing import Any, cast

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates

from app.client import SimpleLoginClient
from app.config import ALIASES_PER_PAGE
from app.ratelimiter import WaitCallback
from app.services import (
    fetch_alias_count,
    fetch_page,
    format_rows,
)

log: logging.Logger = logging.getLogger("slogin")
router: APIRouter = APIRouter()
templates: Jinja2Templates = Jinja2Templates(directory="templates")


def _render(template_name: str, **context: Any) -> str:
    """Render a Jinja2 template and return the result as a string."""
    return cast(str, templates.get_template(template_name).render(**context))  # type: ignore[union-attr]


def _get_client(request: Request) -> SimpleLoginClient:
    client: SimpleLoginClient = request.app.state.client
    return client


@router.get("/")
async def index(request: Request) -> HTMLResponse:
    log.info("GET / from %s", request.client.host if request.client else "unknown")
    return templates.TemplateResponse(request, "index.html", {"total": "…"})  # type: ignore[return-value]


@router.get("/aliases/stream")
async def aliases_stream(request: Request) -> StreamingResponse:
    """SSE endpoint: streams rendered table rows page-by-page in order."""
    log.info("GET /aliases/stream (SSE)")
    client: SimpleLoginClient = _get_client(request)

    async def generate() -> AsyncGenerator[str, None]:
        total_start: float = time.monotonic()
        prefetch_count: int = 9
        results: dict[int, list[dict[str, Any]]] = {}
        event_queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

        prev_on_wait: WaitCallback | None = client.limiter.on_wait

        async def rate_wait_cb(secs: float) -> None:
            await event_queue.put(("ratelimit", secs))

        client.limiter.on_wait = rate_wait_cb

        async def fetch_and_store(page_id: int) -> None:
            pid, batch = await fetch_page(client, page_id)
            await event_queue.put(("page_ready", (pid, batch)))

        # Phase 1: stats + pages 0-8
        stats_task: asyncio.Task[int] = asyncio.create_task(
            fetch_alias_count(client)
        )
        for p in range(prefetch_count):
            asyncio.create_task(fetch_and_store(p))

        next_page: int = 0
        total_sent: int = 0
        total_pages: int | None = None

        while True:
            try:
                event_type, event_data = await asyncio.wait_for(
                    event_queue.get(),
                    timeout=30,
                )
            except asyncio.TimeoutError:
                if total_pages is not None and next_page >= total_pages:
                    break
                continue

            if event_type == "ratelimit":
                yield f"event: ratelimit\ndata: {event_data:.1f}\n\n"
            elif event_type == "page_ready":
                results[event_data[0]] = event_data[1]

            # Drain any remaining queued events
            while not event_queue.empty():
                try:
                    et, ed = event_queue.get_nowait()
                    if et == "ratelimit":
                        yield f"event: ratelimit\ndata: {ed:.1f}\n\n"
                    elif et == "page_ready":
                        results[ed[0]] = ed[1]
                except asyncio.QueueEmpty:
                    break

            # Determine total pages once stats returns
            if total_pages is None and stats_task.done():
                nb_alias: int = stats_task.result()
                total_pages = max(1, math.ceil(nb_alias / ALIASES_PER_PAGE))
                for p in range(prefetch_count, total_pages):
                    asyncio.create_task(fetch_and_store(p))

            # Yield consecutive ready pages in order
            while True:
                batch: list[dict[str, Any]] | None = results.get(next_page)
                if batch is None:
                    if next_page > 0:
                        prev: list[dict[str, Any]] = results.get(
                            next_page - 1, []
                        )
                        if len(prev) < ALIASES_PER_PAGE:
                            total_pages = next_page
                    break

                if len(batch) == 0:
                    total_pages = next_page
                    break

                rows = format_rows(batch)
                pinned_rows = [r for r in rows if r.pinned]
                unpinned_rows = [r for r in rows if not r.pinned]
                total_sent += len(rows)

                if pinned_rows:
                    pinned_dicts = [r.model_dump() for r in pinned_rows]
                    phtml: str = _render(
                        "rows.html",
                        aliases=pinned_dicts,
                        total=total_sent,
                    )
                    escaped: str = phtml.replace("\n", "\ndata: ")
                    yield f"event: pinned\ndata: {escaped}\n\n"
                if unpinned_rows:
                    unpinned_dicts = [r.model_dump() for r in unpinned_rows]
                    uhtml: str = _render(
                        "rows.html",
                        aliases=unpinned_dicts,
                        total=total_sent,
                    )
                    escaped = uhtml.replace("\n", "\ndata: ")
                    yield f"event: page\ndata: {escaped}\n\n"

                if len(batch) < ALIASES_PER_PAGE:
                    total_pages = next_page + 1

                next_page += 1

            if total_pages is not None and next_page >= total_pages:
                break

        yield f"event: done\ndata: {total_sent}\n\n"
        client.limiter.on_wait = prev_on_wait
        total_ms: float = (time.monotonic() - total_start) * 1000
        log.info("streamed %d aliases in %.0fms", total_sent, total_ms)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
