# slogin

A minimal, opinionated web client for [SimpleLogin](https://simplelogin.io).
Optimized for compact visibility and quick alias management.

> Note: This project is designed to run either locally or on private networks.
> DO NOT expose this publicly, since there is no built-in authentication.

## Features

- Single-page view of all aliases with SSE streaming
- Fuzzy search across emails and descriptions
- Sortable columns (status, alias, description, last activity, created)
- Inline note editing, pin/unpin, enable/disable, delete
- Alias creation with custom prefix, domain selection, and random mode
- Click-to-copy email addresses
- Rate-limited API proxy to stay within SimpleLogin limits

## Setup

Requires [uv](https://docs.astral.sh/uv/) and Python >= 3.14.

```bash
git clone https://github.com/yuzhoumo/slogin.git
cd slogin
uv sync
```

Create a `.env` file with your
[SimpleLogin API key](https://app.simplelogin.io/dashboard/enter_sudo?next=%2Fdashboard%2Fapi_key):

```
SLOGIN_API_KEY=your_api_key_here
```

## Usage

```bash
uv run server.py
```

Open `http://localhost:5000`.

## Configuration

All settings are optional environment variables (or `.env` entries):

| Variable                  | Default                      | Description         |
|---------------------------|------------------------------|---------------------|
| `SLOGIN_API_KEY`          | *(required)*                 | SimpleLogin API key |
| `SLOGIN_API_BASE`         | `https://app.simplelogin.io` | API base URL        |
