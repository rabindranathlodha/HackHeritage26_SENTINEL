"""Schemas for POST /predict/text (spec 5.2).

The raw text is NEVER persisted. In production the text is processed on-device
and only the derived contribution is transmitted; this endpoint exists for the
demo path and for on-device model parity testing.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class TextRequest(BaseModel):
    user_id: str
    text: str = Field(min_length=1)
    language: str = "en"


class TextResponse(BaseModel):
    score_b: float = Field(ge=0.0, le=1.0)
    language_detected: str
