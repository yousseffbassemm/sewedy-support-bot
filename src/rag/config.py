"""
rag.config — load config/rag.yaml into typed, validated Settings.

Run directly to sanity-check your config:
    uv run python -m rag.config
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, ValidationError


class EmbeddingConfig(BaseModel):
    provider: Literal["local", "azure"] = "local"
    local_model: str
    azure_model: str
    dimension: int = Field(ge=1)


class RetrievalConfig(BaseModel):
    top_k: int = Field(ge=1)


class ChromaConfig(BaseModel):
    persist_dir: str
    collection: str


class PathsConfig(BaseModel):
    raw_csv: str
    clean_jsonl: str
    review_jsonl: str


class Settings(BaseModel):
    embedding: EmbeddingConfig
    retrieval: RetrievalConfig
    chroma: ChromaConfig
    paths: PathsConfig


def load_config(path: str = "config/rag.yaml") -> Settings:
    """Read YAML settings and validate them into a typed Settings object.

    Fails loudly (clear error, non-zero exit) if the file is missing,
    malformed, or any field is missing/invalid — rather than letting a bad
    config crash deep inside ingest/index/retrieve later.
    """
    config_path = Path(path)
    if not config_path.exists():
        print(f"[config] ERROR: config file not found at '{config_path}'", file=sys.stderr)
        sys.exit(1)

    try:
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        print(f"[config] ERROR: could not parse YAML in '{config_path}':\n{exc}", file=sys.stderr)
        sys.exit(1)

    try:
        return Settings(**raw)
    except ValidationError as exc:
        print(f"[config] ERROR: invalid settings in '{config_path}':\n{exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    settings = load_config()
    print("Config loaded successfully:\n")
    print(settings.model_dump_json(indent=2))