"""Rate-limited httpx wrappers for the SimpleLogin API."""

from __future__ import annotations

from typing import Any

import httpx

from app.ratelimiter import RateLimiter


class SimpleLoginClient:
    """Thin async wrapper around httpx with rate limiting."""

    def __init__(self, http: httpx.AsyncClient, limiter: RateLimiter) -> None:
        self._http: httpx.AsyncClient = http
        self._limiter: RateLimiter = limiter

    @property
    def limiter(self) -> RateLimiter:
        return self._limiter

    async def get(
        self, path: str, params: dict[str, Any] | None = None
    ) -> httpx.Response:
        await self._limiter.acquire()
        return await self._http.get(path, params=params)

    async def post(
        self,
        path: str,
        json_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> httpx.Response:
        await self._limiter.acquire()
        return await self._http.post(path, json=json_body, params=params)

    async def patch(
        self, path: str, json_body: dict[str, Any] | None = None
    ) -> httpx.Response:
        await self._limiter.acquire()
        return await self._http.patch(path, json=json_body)

    async def delete(self, path: str) -> httpx.Response:
        await self._limiter.acquire()
        return await self._http.delete(path)

    async def aclose(self) -> None:
        await self._http.aclose()
