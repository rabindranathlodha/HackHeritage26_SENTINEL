"""Response schema for GET /health (spec 5.5)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ModelsLoaded(BaseModel):
    a: bool = Field(description="Model A — structured behavioral risk (XGBoost)")
    b: bool = Field(description="Model B — self-assessment NLP (IndicBERT)")
    c: bool = Field(description="Model C — physiological wellness signal")


class HealthResponse(BaseModel):
    status: str
    models_loaded: ModelsLoaded
