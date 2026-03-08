"""Entry point: `uv run server.py` or `uvicorn app.main:app`."""

from app.main import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", reload=True, port=5000)

__all__: list[str] = ["app"]
