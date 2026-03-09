# bundle & minify frontend assets
FROM node:lts-alpine AS builder

WORKDIR /build
COPY static/ static/
RUN npx --yes esbuild \
      static/js/main.js --bundle --minify --format=iife --outfile=dist/js/main.js && \
    npx --yes esbuild \
      static/js/ufuzzy.js --minify --outfile=dist/js/ufuzzy.js && \
    npx --yes esbuild \
      static/style.css --bundle --minify --outfile=dist/style.css

# production runtime
FROM python:3.14-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1

WORKDIR /app

# install dependencies (cached layer)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# copy application source
COPY app/ app/
COPY templates/ templates/
COPY server.py ./

# copy bundled assets from builder stage
COPY --from=builder /build/dist/ static/

# non-root user for security
RUN addgroup --system app && adduser --system --ingroup app app
USER app

EXPOSE 5000

CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000"]
