# sslogin

Simple-SimpleLogin (sslogin) is a minimal opinionated client for SimpleLogin.
It is optimized for compact visibility and exposes quick shortcuts for common
use cases.

Features:
- Compact single-page list of all aliases
-

## Setup

```bash
# Install dependencies
uv sync

# Add your SimpleLogin API key
echo "apikey=YOUR_API_KEY" > .env

# Run the server
uv run server.py
```

The app will be available at `http://localhost:5000`.

You can also run directly with uvicorn:

```bash
uv run uvicorn app.main:app --reload --port 5000
```
