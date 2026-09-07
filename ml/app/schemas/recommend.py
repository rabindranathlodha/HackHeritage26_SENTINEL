"""Schemas for POST /recommend (spec Section 11)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.config import RiskBand


class RecommendRequest(BaseModel):
    """Category-level context ONLY.

    Note what this cannot carry: there is no user_id, no free text and no date.
    Spec 11 requires category-level context only, so the type system is where
    that is enforced — a caller cannot pass identifying detail even by mistake,
    and the request cannot be correlated back to a person.
    """

    # extra="forbid" so an attempt to attach identity is REJECTED rather than
    # silently dropped. Silently ignoring it would still be safe, but a caller
    # would go on believing they had sent it — and the next person to read the
    # calling code would believe it too.
    model_config = {"extra": "forbid"}

    band: RiskBand
    shap_categories: dict[str, float] = Field(min_length=1)


class RecommendSource(BaseModel):
    citation: str
    title: str
    publisher: str
    source_url: str
    authoritative: bool


class RecommendResponse(BaseModel):
    suggestion: str | None
    sources: list[RecommendSource]
    authoritative: bool
    warning: str | None = None
    # Spec 11: for the officer, never auto-sent.
    action_taken: str = "none"
    for_: str = Field(default="welfare_officer_review", alias="for")

    model_config = {"populate_by_name": True}
