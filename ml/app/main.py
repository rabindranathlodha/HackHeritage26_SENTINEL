"""SENTINEL ML service — FastAPI entrypoint.

Serves the model endpoints defined in spec Section 5. Every response passes
through the clinical-claims middleware before it leaves the process.
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.models import model_a, model_b, model_c
from app.privacy.claims import ClinicalClaimError, assert_no_clinical_claims
from app.routers import health, predict

logger = logging.getLogger("sentinel.claims")

@asynccontextmanager
async def lifespan(_: FastAPI):
    """Load whatever model artifacts exist.

    A missing artifact is not fatal: the service starts, /health reports that
    model as not loaded, and its endpoint answers 503. Nothing ever falls back
    to a stub silently.
    """
    model_a.load()
    model_b.load()
    model_c.load()
    yield


app = FastAPI(
    lifespan=lifespan,
    title="SENTINEL ML Service",
    version="0.1.0",
    description=(
        "Surfaces elevated welfare-risk indicators for human review. "
        "Not a clinical diagnosis."
    ),
)


def _rebuild(body: bytes, original) -> JSONResponse:
    """Rebuild a response after its body stream has been consumed."""
    headers = dict(original.headers)
    headers.pop("content-length", None)
    return JSONResponse(
        content=json.loads(body) if body else None,
        status_code=original.status_code,
        headers=headers,
    )


class ClinicalClaimsMiddleware(BaseHTTPMiddleware):
    """Scan every outgoing JSON response for clinical language (spec 10).

    A violation is a bug in SENTINEL, not a client error, so it fails the
    request with a 500 rather than leaking the payload. The offending term is
    logged for the developer but never returned to the caller.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        content_type = response.headers.get("content-type", "")
        if not content_type.startswith("application/json"):
            return response

        body = b"".join([chunk async for chunk in response.body_iterator])

        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            # Not something we can inspect; pass it through unchanged.
            return _rebuild(body, response)

        try:
            assert_no_clinical_claims(payload)
        except ClinicalClaimError as exc:
            logger.error("blocked outgoing response: %s", exc)
            return JSONResponse(
                status_code=500,
                content={
                    "error": "response_blocked_by_claims_guard",
                    "detail": (
                        "The generated response contained language outside the "
                        "welfare-risk boundary and was withheld."
                    ),
                },
            )

        return _rebuild(body, response)


app.add_middleware(ClinicalClaimsMiddleware)

app.include_router(health.router)
app.include_router(predict.router)


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"service": settings.service_name}
