import os
import math
import time
import logging
import threading
import requests
from queue import Queue, Empty
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from flask import Flask, make_response, render_template, Response, request as flask_request, jsonify
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sslogin")

app = Flask(__name__)

API_BASE = "https://app.simplelogin.io"
API_KEY = os.getenv("apikey")
ALIASES_PER_PAGE = 20
RATE_LIMIT = 50  # requests per minute


class RateLimiter:
    """Simple sliding-window rate limiter (thread-safe)."""

    def __init__(self, max_calls, period=60.0):
        self.max_calls = max_calls
        self.period = period
        self.timestamps = []
        self.lock = threading.Lock()
        self.on_wait = None  # optional callback(wait_seconds)

    def acquire(self):
        """Acquire a slot. Returns the number of seconds waited, or 0."""
        with self.lock:
            now = time.monotonic()
            self.timestamps = [t for t in self.timestamps if now - t < self.period]
            if len(self.timestamps) >= self.max_calls:
                wait = self.period - (now - self.timestamps[0])
                log.info("rate limit: sleeping %.1fs", wait)
                if self.on_wait:
                    self.on_wait(wait)
                time.sleep(wait)
                now = time.monotonic()
                self.timestamps = [t for t in self.timestamps if now - t < self.period]
                self.timestamps.append(time.monotonic())
                return wait
            self.timestamps.append(time.monotonic())
            return 0


rate_limiter = RateLimiter(RATE_LIMIT)


def api_get(path, params=None):
    """Rate-limited GET request to the SimpleLogin API."""
    rate_limiter.acquire()
    return requests.get(
        f"{API_BASE}{path}",
        headers={"Authentication": API_KEY},
        params=params,
    )


def api_post(path, json_body=None, params=None):
    """Rate-limited POST request to the SimpleLogin API."""
    rate_limiter.acquire()
    return requests.post(
        f"{API_BASE}{path}",
        headers={"Authentication": API_KEY},
        json=json_body,
        params=params,
    )


def api_patch(path, json_body=None):
    """Rate-limited PATCH request to the SimpleLogin API."""
    rate_limiter.acquire()
    return requests.patch(
        f"{API_BASE}{path}",
        headers={"Authentication": API_KEY},
        json=json_body,
    )


def api_delete(path):
    """Rate-limited DELETE request to the SimpleLogin API."""
    rate_limiter.acquire()
    return requests.delete(
        f"{API_BASE}{path}",
        headers={"Authentication": API_KEY},
    )


def fetch_alias_count():
    """Use the stats endpoint to determine total alias count."""
    resp = api_get("/api/stats")
    resp.raise_for_status()
    count = resp.json().get("nb_alias", 0)
    log.info("stats: %d aliases total", count)
    return count


def fetch_page(page_id):
    """Fetch a single page of aliases."""
    page_start = time.monotonic()
    resp = api_get("/api/v2/aliases", params={"page_id": page_id})
    elapsed = (time.monotonic() - page_start) * 1000
    batch = resp.json().get("aliases", [])
    log.info("page %d  %d %s  %d aliases  %.0fms",
             page_id, resp.status_code, resp.reason, len(batch), elapsed)
    resp.raise_for_status()
    return page_id, batch


def fetch_all_aliases():
    """Fetch all aliases concurrently, respecting rate limits.

    Fires stats + pages 0-8 in one batch. If any prefetched page is empty,
    we're done early. Otherwise, stats tells us how many remaining pages to fetch.
    """
    total_start = time.monotonic()
    prefetch_count = 9
    results = {}

    with ThreadPoolExecutor(max_workers=prefetch_count + 1) as pool:
        # Phase 1: stats + first 9 pages concurrently
        stats_future = pool.submit(fetch_alias_count)
        page_futures = {pool.submit(fetch_page, p): p for p in range(prefetch_count)}

        # Collect prefetched pages
        early_done = False
        for future in as_completed(page_futures):
            page_id, batch = future.result()
            results[page_id] = batch
            if len(batch) < ALIASES_PER_PAGE:
                early_done = True

        nb_alias = stats_future.result()

        if early_done:
            total_pages = max((p for p in results if results[p]) or [0]) + 1 if results else 0
            log.info("early finish: all data within first %d pages", total_pages)
        else:
            # Phase 2: fetch remaining pages beyond the prefetch window
            total_pages = max(prefetch_count, math.ceil(nb_alias / ALIASES_PER_PAGE))
            remaining = range(prefetch_count, total_pages)
            if remaining:
                log.info("fetching %d remaining pages (%d-%d)", len(remaining), remaining[0], remaining[-1])
                rem_futures = {pool.submit(fetch_page, p): p for p in remaining}
                for future in as_completed(rem_futures):
                    page_id, batch = future.result()
                    results[page_id] = batch

    aliases = []
    for p in sorted(results.keys()):
        aliases.extend(results[p])

    total_ms = (time.monotonic() - total_start) * 1000
    log.info("fetched %d aliases across %d pages in %.0fms", len(aliases), len(results), total_ms)
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


@app.route("/")
def index():
    log.info("GET / from %s", flask_request.remote_addr)
    return render_template("index.html", total="…")


@app.route("/aliases/stream")
def aliases_stream():
    """SSE endpoint: streams rendered table rows page-by-page in order."""
    log.info("GET /aliases/stream (SSE)")

    def generate():
        with app.app_context():
            total_start = time.monotonic()
            prefetch_count = 9
            results = {}
            ready = threading.Event()
            results_lock = threading.Lock()
            rate_events = Queue()

            prev_on_wait = rate_limiter.on_wait
            rate_limiter.on_wait = lambda secs: rate_events.put(secs)

            def store_page(page_id, batch):
                with results_lock:
                    results[page_id] = batch
                ready.set()

            def fetch_and_store(page_id):
                pid, batch = fetch_page(page_id)
                store_page(pid, batch)

            pool = ThreadPoolExecutor(max_workers=10)

            # Phase 1: stats + pages 0-8
            stats_future = pool.submit(fetch_alias_count)
            for p in range(prefetch_count):
                pool.submit(fetch_and_store, p)

            next_page = 0
            total_sent = 0
            total_pages = None

            while True:
                ready.wait(timeout=30)
                ready.clear()

                # Emit any rate-limit events to the client
                while not rate_events.empty():
                    try:
                        secs = rate_events.get_nowait()
                        yield f"event: ratelimit\ndata: {secs:.1f}\n\n"
                    except Empty:
                        break

                # Determine total pages once stats returns
                if total_pages is None and stats_future.done():
                    nb_alias = stats_future.result()
                    total_pages = max(1, math.ceil(nb_alias / ALIASES_PER_PAGE))
                    # Submit remaining pages beyond prefetch
                    for p in range(prefetch_count, total_pages):
                        pool.submit(fetch_and_store, p)

                # Yield consecutive ready pages in order
                while True:
                    with results_lock:
                        batch = results.get(next_page)
                    if batch is None:
                        # Check early termination: previous page had < 20 results
                        if next_page > 0:
                            with results_lock:
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
                        phtml = render_template("rows.html", aliases=pinned_rows, total=total_sent)
                        escaped = phtml.replace("\n", "\ndata: ")
                        yield f"event: pinned\ndata: {escaped}\n\n"
                    if unpinned_rows:
                        uhtml = render_template("rows.html", aliases=unpinned_rows, total=total_sent)
                        escaped = uhtml.replace("\n", "\ndata: ")
                        yield f"event: page\ndata: {escaped}\n\n"

                    if len(batch) < ALIASES_PER_PAGE:
                        total_pages = next_page + 1

                    next_page += 1

                if total_pages is not None and next_page >= total_pages:
                    break

            # Send final count + done signal
            yield f"event: done\ndata: {total_sent}\n\n"
            rate_limiter.on_wait = prev_on_wait
            pool.shutdown(wait=False)
            total_ms = (time.monotonic() - total_start) * 1000
            log.info("streamed %d aliases in %.0fms", total_sent, total_ms)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/aliases")
def aliases_partial():
    """Non-streaming fallback: returns all rows at once."""
    log.info("GET /aliases (full fetch)")
    req_start = time.monotonic()
    aliases = fetch_all_aliases()
    rows = format_rows(aliases)
    html = render_template("rows.html", aliases=rows, total=len(rows))
    log.info("total %.0fms", (time.monotonic() - req_start) * 1000)
    resp = make_response(html)
    resp.headers["HX-Trigger"] = '{"updateCount": ' + str(len(rows)) + '}'
    return resp


@app.route("/api/toggle/<int:alias_id>", methods=["POST"])
def toggle_alias(alias_id):
    """Proxy toggle request to SimpleLogin API."""
    log.info("POST /api/toggle/%d", alias_id)
    try:
        resp = api_post(f"/api/aliases/{alias_id}/toggle")
        resp.raise_for_status()
        return jsonify(resp.json())
    except Exception as e:
        log.error("toggle failed for alias %d: %s", alias_id, e)
        return jsonify({"error": str(e)}), 502


@app.route("/api/alias/<int:alias_id>", methods=["DELETE"])
def delete_alias(alias_id):
    """Delete an alias."""
    log.info("DELETE /api/alias/%d", alias_id)
    try:
        resp = api_delete(f"/api/aliases/{alias_id}")
        resp.raise_for_status()
        return jsonify(resp.json())
    except Exception as e:
        log.error("delete failed for alias %d: %s", alias_id, e)
        return jsonify({"error": str(e)}), 502


@app.route("/api/alias/<int:alias_id>/note", methods=["PATCH"])
def update_alias_note(alias_id):
    """Update the note/description of an alias."""
    data = flask_request.get_json(force=True)
    note = data.get("note", "")
    resp = api_patch(f"/api/aliases/{alias_id}", json_body={"note": note})
    return (resp.json(), resp.status_code)


@app.route("/api/alias/<int:alias_id>/pin", methods=["PATCH"])
def toggle_pin(alias_id):
    """Toggle pinned state of an alias."""
    data = flask_request.get_json(force=True)
    pinned = data.get("pinned", False)
    log.info("PATCH /api/alias/%d/pin pinned=%s", alias_id, pinned)
    resp = api_patch(f"/api/aliases/{alias_id}", json_body={"pinned": pinned})
    return (resp.json(), resp.status_code)


@app.route("/api/alias/options")
def alias_options():
    """Get alias creation options (suffixes, mailboxes)."""
    log.info("GET /api/alias/options")
    opts_resp = api_get("/api/v5/alias/options")
    opts_resp.raise_for_status()
    mb_resp = api_get("/api/v2/mailboxes")
    mb_resp.raise_for_status()
    mailboxes = mb_resp.json().get("mailboxes", [])
    default_mb = next((m for m in mailboxes if m.get("default")), mailboxes[0] if mailboxes else None)
    result = opts_resp.json()
    result["default_mailbox_id"] = default_mb["id"] if default_mb else None
    return jsonify(result)


@app.route("/api/alias/create", methods=["POST"])
def create_alias():
    """Create a new alias. Handles both random and custom creation."""
    data = flask_request.get_json(force=True)
    log.info("POST /api/alias/create %s", data)

    if data.get("random_uuid"):
        resp = api_post("/api/alias/random/new", params={"mode": "uuid"})
    else:
        body = {
            "alias_prefix": data["prefix"],
            "signed_suffix": data["signed_suffix"],
            "mailbox_ids": data["mailbox_ids"],
        }
        if data.get("note"):
            body["note"] = data["note"]
        resp = api_post("/api/v3/alias/custom/new", json_body=body)

    return (resp.json(), resp.status_code)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
