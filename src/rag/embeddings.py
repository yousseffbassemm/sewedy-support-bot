"""
rag.embeddings -- Day 2: provider-agnostic text -> vector abstraction.

Defines the Embedder contract (Protocol) and two implementations:
  - LocalMiniLMEmbedder (default, offline)
  - AzureEmbedder (opt-in, needs .env)

get_embedder(cfg) is the ONLY place that branches on provider. Everything
downstream (index.py, retrieve.py) just calls .embed().
"""

from __future__ import annotations

import os
from typing import Protocol

from rag.config import EmbeddingConfig


class Embedder(Protocol):
    dimension: int

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts, returning one vector per text."""
        ...


class LocalMiniLMEmbedder:
    """Wraps sentence-transformers MiniLM. Lazy-loads the model so importing
    this module stays cheap. Produces normalized (unit) vectors so cosine
    distance behaves correctly."""

    def __init__(self, model_name: str, dimension: int) -> None:
        self._model_name = model_name
        self.dimension = dimension
        self._model = None  # lazy-loaded on first embed()

    def _load(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            print(f"[embeddings] loading local model '{self._model_name}' (first use only)...")
            self._model = SentenceTransformer(self._model_name)
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        model = self._load()
        vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return vectors.tolist()


class AzureEmbedder:
    """Uses Azure OpenAI. Reads credentials from environment variables
    (populate via .env + python-dotenv). NOTE the #1 Azure gotcha: the
    `model=` argument to embeddings.create wants the DEPLOYMENT name you
    chose in the Azure portal, NOT the public model name -- getting this
    wrong yields a confusing 404."""

    def __init__(self, model_name: str, dimension: int) -> None:
        self.dimension = dimension
        self._deployment = model_name
        self._client = None  # lazy-init on first embed()

    def _load(self):
        if self._client is None:
            missing = [
                var
                for var in (
                    "AZURE_OPENAI_ENDPOINT",
                    "AZURE_OPENAI_API_KEY",
                    "AZURE_OPENAI_API_VERSION",
                )
                if not os.environ.get(var)
            ]
            if missing:
                raise RuntimeError(
                    f"[embeddings] Azure provider selected but missing env var(s): "
                    f"{', '.join(missing)}. Set them in .env."
                )
            from openai import AzureOpenAI

            self._client = AzureOpenAI(
                azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
                api_key=os.environ["AZURE_OPENAI_API_KEY"],
                api_version=os.environ["AZURE_OPENAI_API_VERSION"],
            )
        return self._client

    def embed(self, texts: list[str]) -> list[list[float]]:
        client = self._load()
        # model= here is the Azure DEPLOYMENT name, not the model name.
        response = client.embeddings.create(model=self._deployment, input=texts)
        return [item.embedding for item in response.data]


def get_embedder(cfg: EmbeddingConfig) -> Embedder:
    """The single place that branches on provider."""
    if cfg.provider == "local":
        return LocalMiniLMEmbedder(model_name=cfg.local_model, dimension=cfg.dimension)
    elif cfg.provider == "azure":
        return AzureEmbedder(model_name=cfg.azure_model, dimension=cfg.dimension)
    raise ValueError(f"Unknown embedding provider: {cfg.provider!r}")