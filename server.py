import os
import math
import time
import asyncio
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sslogin")

API_BASE = "https://app.simplelogin.io"
API_KEY = os.getenv("apikey")
ALIASES_PER_PAGE = 20
RATE_LIMIT = 50  # requests per minute

http_client: httpx.AsyncClient = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(
        base_url=API_BASE,
        headers={"Authentication": API_KEY},
    )
    yield
    await http_client.aclose()


app = FastAPI(lifespan=lifespan)
templates = Jinja2Templates(directory="templates")


class RateLimiter:
    """Async sliding-window rate limiter."""

    def __init__(self, max_calls: int, period: float = 60.0):
        self.max_calls = max_calls
        self.period = period
        self.timestamps: list[float] = []
        self.lock = asyncio.Lock()
        self.on_wait = None  # optional async callback(wait_seconds)

    async def acquire(self) -> float:
        async with self.lock:
            now = time.monotonic()
            self.timestamps = [t for t in self.timestamps if now - t < self.period]
            if len(self.timestamps) >= self.max_calls:
                wait = self.period - (now - self.timestamps[0])
                log.info("rate limit: sleeping %.1fs", wait)
                if self.on_wait:
                    await self.on_wait(wait)
                await asyncio.sleep(wait)
                now = time.monotonic()
                self.timestamps = [
                    t for t in self.timestamps if now - t < self.period
                ]
                self.timestamps.append(time.monotonic())
                return wait
            self.timestamps.append(time.monotonic())
            return 0


rate_limiter = RateLimiter(RATE_LIMIT)


async def api_get(path: str, params=None):
    """Rate-limited GET request to the SimpleLogin API."""
    await rate_limiter.acquire()
    return await http_client.get(path, params=params)


async def api_post(path: str, json_body=None, params=None):
    """Rate-limited POST request to the SimpleLogin API."""
    await rate_limiter.acquire()
    return await http_client.post(path, json=json_body, params=params)


async def api_patch(path: str, json_body=None):
    """Rate-limited PATCH request to the SimpleLogin API."""
    await rate_limiter.acquire()
    return await http_client.patch(path, json=json_body)


async def api_delete(path: str):
    """Rate-limited DELETE request to the SimpleLogin API."""
    await rate_limiter.acquire()
    return await http_client.delete(path)


async def fetch_alias_count() -> int:
    """Use the stats endpoint to determine total alias count."""
    resp = await api_get("/api/stats")
    resp.raise_for_status()
    count = resp.json().get("nb_alias", 0)
    log.info("stats: %d aliases total", count)
    return count


async def fetch_page(page_id: int):
    """Fetch a single page of aliases."""
    page_start = time.monotonic()
    resp = await api_get("/api/v2/aliases", params={"page_id": page_id})
    elapsed = (time.monotonic() - page_start) * 1000
    batch = resp.json().get("aliases", [])
    log.info(
        "page %d  %d %s  %d aliases  %.0fms",
        page_id, resp.status_code, resp.reason_phrase, len(batch), elapsed,
    )
    resp.raise_for_status()
    return page_id, batch


async def fetch_all_aliases():
    """Fetch all aliases concurrently, respecting rate limits.

    Fires stats + pages 0-8 in one batch. If any prefetched page is empty,
    we're done early. Otherwise, stats tells us how many remaining pages to fetch.
    """
    total_start = time.monotonic()
    prefetch_count = 9
    results = {}

    # Phase 1: stats + first 9 pages concurrently
    tasks = [fetch_alias_count()] + [fetch_page(p) for p in range(prefetch_count)]
    completed = await asyncio.gather(*tasks)

    nb_alias = completed[0]
    early_done = False
    for page_id, batch in completed[1:]:
        results[page_id] = batch
        if len(batch) < ALIASES_PER_PAGE:
            early_done = True

    if early_done:
        total_pages = max((p for p in results if results[p]), default=0) + 1
        log.info("early finish: all data within first %d pages", total_pages)
    else:
        # Phase 2: fetch remaining pages beyond the prefetch window
        total_pages = max(prefetch_count, math.ceil(nb_alias / ALIASES_PER_PAGE))
        remaining = range(prefetch_count, total_pages)
        if remaining:
            log.info(
                "fetching %d remaining pages (%d-%d)",
                len(remaining), remaining[0], remaining[-1],
            )
            rem_completed = await asyncio.gather(
                *[fetch_page(p) for p in remaining]
            )
            for page_id, batch in rem_completed:
                results[page_id] = batch

    aliases = []
    for p in sorted(results.keys()):
        aliases.extend(results[p])

    total_ms = (time.monotonic() - total_start) * 1000
    log.info(
        "fetched %d aliases across %d pages in %.0fms",
        len(aliases), len(results), total_ms,
    )
    return aliases


def format_timestamp(ts):
    if ts is None:
        return "—"
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M")


def format_rows(aliases):
    rows = []
    for a in aliases:
        last_activity = a.get("latest_activity")
        last_ts = last_activity["timestamp"] if last_activity else None
        rows.append({
            "id": a["id"],
            "email": a["email"],
            "enabled": a["enabled"],
            "pinned": a.get("pinned", False),
            "note": a.get("note") or "",
            "creation_ts": a.get("creation_timestamp"),
            "creation_date": format_timestamp(a.get("creation_timestamp")),
            "last_activity": format_timestamp(last_ts),
            "last_activity_ts": last_ts,
        })
    return rows


@app.get("/")
async def index(request: Request):
    log.info("GET / from %s", request.client.host)
    return templates.TemplateResponse(request, "index.html", {"total": "…"})


@app.get("/aliases/stream")
async def aliases_stream():
    """SSE endpoint: streams rendered table rows page-by-page in order."""
    log.info("GET /aliases/stream (SSE)")

    async def generate():
        total_start = time.monotonic()
        prefetch_count = 9
        results = {}
        event_queue: asyncio.Queue = asyncio.Queue()

        prev_on_wait = rate_limiter.on_wait

        async def rate_wait_cb(secs):
            await event_queue.put(("ratelimit", secs))

        rate_limiter.on_wait = rate_wait_cb

        async def fetch_and_store(page_id):
            pid, batch = await fetch_page(page_id)
            await event_queue.put(("page_ready", (pid, batch)))

        # Phase 1: stats + pages 0-8
        stats_task = asyncio.create_task(fetch_alias_count())
        for p in range(prefetch_count):
            asyncio.create_task(fetch_and_store(p))

        next_page = 0
        total_sent = 0
        total_pages = None

        while True:
            try:
                event_type, event_data = await asyncio.wait_for(
                    event_queue.get(), timeout=30,
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
                nb_alias = stats_task.result()
                total_pages = max(1, math.ceil(nb_alias / ALIASES_PER_PAGE))
                for p in range(prefetch_count, total_pages):
                    asyncio.create_task(fetch_and_store(p))

            # Yield consecutive ready pages in order
            while True:
                batch = results.get(next_page)
                if batch is None:
                    if next_page > 0:
                        prev = results.get(next_page - 1, [])
                        if len(prev) < ALIASES_PER_PAGE:
                            total_pages = next_page
                    break

                if len(batch) == 0:
                    total_pages = next_page
                    break

                rows = format_rows(batch)
                pinned_rows = [r for r in rows if r["pinned"]]
                unpinned_rows = [r for r in rows if not r["pinned"]]
                total_sent += len(rows)

                if pinned_rows:
                    phtml = templates.get_template("rows.html").render(
                        aliases=pinned_rows, total=total_sent,
                    )
                    escaped = phtml.replace("\n", "\ndata: ")
                    yield f"event: pinned\ndata: {escaped}\n\n"
                if unpinned_rows:
                    uhtml = templates.get_template("rows.html").render(
                        aliases=unpinned_rows, total=total_sent,
                    )
                    escaped = uhtml.replace("\n", "\ndata: ")
                    yield f"event: page\ndata: {escaped}\n\n"

                if len(batch) < ALIASES_PER_PAGE:
                    total_pages = next_page + 1

                next_page += 1

            if total_pages is not None and next_page >= total_pages:
                break

        yield f"event: done\ndata: {total_sent}\n\n"
        rate_limiter.on_wait = prev_on_wait
        total_ms = (time.monotonic() - total_start) * 1000
        log.info("streamed %d aliases in %.0fms", total_sent, total_ms)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/aliases")
async def aliases_partial():
    """Non-streaming fallback: returns all rows at once."""
    log.info("GET /aliases (full fetch)")
    req_start = time.monotonic()
    aliases = await fetch_all_aliases()
    rows = format_rows(aliases)
    html = templates.get_template("rows.html").render(aliases=rows, total=len(rows))
    log.info("total %.0fms", (time.monotonic() - req_start) * 1000)
    return HTMLResponse(
        content=html,
        headers={"HX-Trigger": '{"updateCount": ' + str(len(rows)) + '}'},
    )


@app.post("/api/toggle/{alias_id}")
async def toggle_alias(alias_id: int):
    """Proxy toggle request to SimpleLogin API."""
    log.info("POST /api/toggle/%d", alias_id)
    try:
        resp = await api_post(f"/api/aliases/{alias_id}/toggle")
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.error("toggle failed for alias %d: %s", alias_id, e)
        return JSONResponse({"error": str(e)}, status_code=502)


@app.delete("/api/alias/{alias_id}")
async def delete_alias(alias_id: int):
    """Delete an alias."""
    log.info("DELETE /api/alias/%d", alias_id)
    try:
        resp = await api_delete(f"/api/aliases/{alias_id}")
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.error("delete failed for alias %d: %s", alias_id, e)
        return JSONResponse({"error": str(e)}, status_code=502)


@app.patch("/api/alias/{alias_id}/note")
async def update_alias_note(alias_id: int, request: Request):
    """Update the note/description of an alias."""
    data = await request.json()
    note = data.get("note", "")
    resp = await api_patch(f"/api/aliases/{alias_id}", json_body={"note": note})
    return JSONResponse(resp.json(), status_code=resp.status_code)


@app.patch("/api/alias/{alias_id}/pin")
async def toggle_pin(alias_id: int, request: Request):
    """Toggle pinned state of an alias."""
    data = await request.json()
    pinned = data.get("pinned", False)
    log.info("PATCH /api/alias/%d/pin pinned=%s", alias_id, pinned)
    resp = await api_patch(f"/api/aliases/{alias_id}", json_body={"pinned": pinned})
    return JSONResponse(resp.json(), status_code=resp.status_code)


@app.get("/api/alias/options")
async def alias_options():
    """Get alias creation options (suffixes, mailboxes)."""
    log.info("GET /api/alias/options")
    opts_resp = await api_get("/api/v5/alias/options")
    opts_resp.raise_for_status()
    mb_resp = await api_get("/api/v2/mailboxes")
    mb_resp.raise_for_status()
    mailboxes = mb_resp.json().get("mailboxes", [])
    default_mb = next(
        (m for m in mailboxes if m.get("default")),
        mailboxes[0] if mailboxes else None,
    )
    result = opts_resp.json()
    result["default_mailbox_id"] = default_mb["id"] if default_mb else None
    return result


@app.post("/api/alias/create")
async def create_alias(request: Request):
    """Create a new alias. Handles both random and custom creation."""
    data = await request.json()
    log.info("POST /api/alias/create %s", data)

    if data.get("random_uuid"):
        resp = await api_post("/api/alias/random/new", params={"mode": "uuid"})
    else:
        body = {
            "alias_prefix": data["prefix"],
            "signed_suffix": data["signed_suffix"],
            "mailbox_ids": data["mailbox_ids"],
        }
        if data.get("note"):
            body["note"] = data["note"]
        resp = await api_post("/api/v3/alias/custom/new", json_body=body)

    return JSONResponse(resp.json(), status_code=resp.status_code)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", reload=True, port=5000)
