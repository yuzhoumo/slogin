"""FastAPI application factory."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.client import SimpleLoginClient
from app.config import API_BASE, API_KEY, RATE_LIMIT
from app.ratelimiter import RateLimiter
from app.routers import api, pages

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    http = httpx.AsyncClient(
        base_url=API_BASE,
        headers={"Authentication": API_KEY},
    )
    app.state.client = SimpleLoginClient(http, RateLimiter(RATE_LIMIT))
    yield
    await app.state.client.aclose()


app: FastAPI = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")
app.include_router(pages.router)
app.include_router(api.router)
