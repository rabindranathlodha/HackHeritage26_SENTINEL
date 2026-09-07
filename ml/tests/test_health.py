"""Step 3.1 acceptance test: GET /health returns 200 with the spec 5.5 shape."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_200_with_contract_shape():
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert set(body["models_loaded"]) == {"a", "b", "c"}
    assert all(isinstance(v, bool) for v in body["models_loaded"].values())


def test_health_reports_true_model_state_not_a_hardcoded_claim():
    """The flags must track the models actually loaded, at every build step."""
    from app.models import model_a, model_b, model_c

    body = client.get("/health").json()

    assert body["models_loaded"]["a"] is model_a.is_loaded()
    assert body["models_loaded"]["b"] is model_b.is_loaded()
    assert body["models_loaded"]["c"] is model_c.is_loaded()
