from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

log: logging.Logger = logging.getLogger("slogin")

# Type alias for the optional rate-limit wait callback
WaitCallback = Callable[[float], Awaitable[None]]


class RateLimiter:
    """Async sliding-window rate limiter."""

    def __init__(self, max_calls: int, period: float = 60.0) -> None:
        self.max_calls: int = max_calls
        self.period: float = period
        self.timestamps: list[float] = []
        self.lock: asyncio.Lock = asyncio.Lock()
        self.on_wait: WaitCallback | None = None

    async def acquire(self) -> float:
        """Acquire a slot. Returns seconds waited (0 if none)."""
        async with self.lock:
            now: float = time.monotonic()
            self.timestamps = [t for t in self.timestamps if now - t < self.period]

            if len(self.timestamps) >= self.max_calls:
                wait: float = self.period - (now - self.timestamps[0])
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
