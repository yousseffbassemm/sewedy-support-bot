# Backend (FastAPI) image for SupportBot.
#
# NOTE: this was authored where Docker was unavailable, so validate with:
#   docker build -t supportbot-backend .
#   docker run -p 8000:8000 -e GEMINI_API_KEY=... -e JWT_SECRET=... supportbot-backend
#
# The clean corpus + Chroma vector index are built INTO the image, so the
# container serves immediately with no first-request delay. Secrets are passed
# at runtime (never baked in).

FROM python:3.11-slim

# uv for fast, reproducible installs
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    HF_HOME=/app/.hf_cache

# Dependencies first, for better layer caching on code-only changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Application code + data.
COPY src ./src
COPY config ./config
COPY data ./data
COPY backend ./backend
COPY eval ./eval
RUN uv sync --frozen --no-dev

# Bake the searchable corpus + vector index into the image.
RUN uv run python -m rag.ingest && uv run python -m rag.index

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
