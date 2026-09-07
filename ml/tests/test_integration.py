"""Vertical-slice integration tests (step 3.4 — the integration gate).

Unlike test_predict.py, these run against the REAL database: real HR history in,
engineered features, scored through every stage, out as a SENTINEL score. This
is the wiring the spec calls the number one failure mode for this build.
"""

from __future__ import annotations

import os

import pandas as pd
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import DISCLAIMER, band_for_score
from app.db import load_hr_history
from app.main import app
from app.services.feature_pipeline import FEATURE_ORDER, compute_features
from tests.conftest import act_as, requires_db

pytestmark = requires_db

client = TestClient(app)

ARTIFACTS = os.environ.get("ARTIFACTS_DIR", "artifacts")
SNAPSHOT = os.path.join(ARTIFACTS, "synthetic_snapshot.parquet")


@pytest.fixture(scope="module")
def seeded_user(request) -> str:
    dsn = os.environ["SENTINEL_APP_DATABASE_URL"]
    with psycopg.connect(dsn) as conn:
        conn.execute("SET LOCAL ROLE sentinel_scoring")
        row = conn.execute(
            'SELECT id FROM "User" WHERE id LIKE %s ORDER BY id LIMIT 1', ("syn-%",)
        ).fetchone()
    if not row:
        pytest.skip("run data_gen.generate_synthetic first")
    return row[0]


# Real history in


def test_features_are_engineered_from_real_database_history(seeded_user):
    history = load_hr_history(seeded_user)
    assert len(history) == 180, "expected a full daily history from Postgres"

    features = compute_features(history)
    dumped = features.model_dump()

    assert set(dumped) == set(FEATURE_ORDER)
    # The values must actually track the history, not fall back to defaults.
    assert dumped["deployment_days"] == int(history.iloc[-1]["deployment_days"])
    assert dumped["days_since_incident"] == int(history.iloc[-1]["days_since_incident"])


def test_feature_values_vary_across_people(seeded_user):
    """A pipeline returning constants would pass every other test in here."""
    dsn = os.environ["SENTINEL_APP_DATABASE_URL"]
    with psycopg.connect(dsn) as conn:
        conn.execute("SET LOCAL ROLE sentinel_scoring")
        ids = [
            r[0]
            for r in conn.execute(
                'SELECT id FROM "User" WHERE id LIKE %s ORDER BY id LIMIT 12', ("syn-%",)
            ).fetchall()
        ]

    deployments = {compute_features(load_hr_history(u)).deployment_days for u in ids}

    assert len(deployments) > 1, "feature pipeline returned identical values for everyone"


def test_train_and_serve_produce_identical_features(seeded_user):
    """The anti-skew check (spec 7.1).

    The same person's features, computed from Postgres and from the training
    snapshot, must be identical. If these ever diverge the model is scoring
    something different from what it was trained on, which no accuracy metric
    would reveal.
    """
    if not os.path.exists(SNAPSHOT):
        pytest.skip("run data_gen.generate_synthetic first")

    serve_features = compute_features(load_hr_history(seeded_user))

    snapshot = pd.read_parquet(SNAPSHOT)
    train_history = snapshot[snapshot["user_id"] == seeded_user]
    train_features = compute_features(train_history)

    assert serve_features.model_dump() == train_features.model_dump()


# Scored all the way through


def test_end_to_end_history_to_sentinel_score(seeded_user):
    features = compute_features(load_hr_history(seeded_user)).model_dump()

    structured = client.post(
        "/predict/structured", json={"user_id": seeded_user, "features": features}
    )
    assert structured.status_code == 200
    a = structured.json()

    physio = client.post(
        "/predict/physiological", json={"user_id": seeded_user, "consent": False}
    )
    assert physio.status_code == 200
    c = physio.json()
    assert c == {"score_c": None, "used": False}

    fusion = client.post(
        "/predict/fusion",
        json={
            "user_id": seeded_user,
            "score_a": a["score_a"],
            "score_b": None,
            "score_c": c["score_c"],
            "shap_categories": a["shap_categories"],
        },
    )
    assert fusion.status_code == 200
    result = fusion.json()

    assert 0.0 <= result["sentinel_score"] <= 100.0
    assert result["band"] == band_for_score(result["sentinel_score"]).value
    assert result["confidence"]["low"] <= result["confidence"]["high"]
    assert result["disclaimer"] == DISCLAIMER
    assert set(result["shap_categories"]) == set(a["shap_categories"])


def test_internal_feature_endpoint_404s_for_an_unknown_person():
    response = client.post("/internal/features/structured?user_id=does-not-exist")

    assert response.status_code == 404


# The scoring path's own privilege boundary


@pytest.mark.parametrize("table", ["Score", "Assessment", "Alert"])
def test_scoring_role_can_write_but_never_read_welfare_rows(app_conn, cohort, table):
    """The scoring pipeline is write-only with respect to welfare content.

    A bug in the scoring path therefore cannot become a data leak — there is
    nothing for it to read back.
    """
    act_as(app_conn, "sentinel_scoring", cohort.commander)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute(f'SELECT * FROM "{table}"').fetchall()


def test_scoring_role_can_read_the_history_it_needs(app_conn, cohort):
    act_as(app_conn, "sentinel_scoring", cohort.commander)

    rows = app_conn.execute('SELECT * FROM "HrSignal" LIMIT 1').fetchall()

    assert isinstance(rows, list)


def test_scoring_role_cannot_reach_the_hidden_training_label(app_conn, cohort):
    act_as(app_conn, "sentinel_scoring", cohort.commander)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        app_conn.execute('SELECT * FROM "_ground_truth"').fetchall()
