"""Score the synthetic population through the real pipeline."""

from __future__ import annotations

import argparse
import json
import os
from datetime import date, timedelta

import pandas as pd
import psycopg

from app.config import band_for_score
from app.models import fusion as fusion_model
from app.models import model_a
from app.services.escalation import ALERT_QUEUE_KEY, evaluate
from app.services.feature_pipeline import compute_features

SNAPSHOT = "synthetic_snapshot.parquet"


def main() -> None:
    parser = argparse.ArgumentParser(description="Score the synthetic population.")
    parser.add_argument("--artifacts", default=os.environ.get("ARTIFACTS_DIR", "artifacts"))
    parser.add_argument("--limit", type=int, default=600,
                        help="number of people to score (0 = all)")
    parser.add_argument("--cutoffs", default="120,150,180",
                        help="day indices to score at, oldest first")
    parser.add_argument("--end-date", default="2026-09-01")
    parser.add_argument("--no-escalate", action="store_true")
    parser.add_argument("--reset", action="store_true",
                        help="clear previously written synthetic scores and alerts first "
                             "(required when re-running, see the INSERT below)")
    args = parser.parse_args()

    snapshot_path = os.path.join(args.artifacts, SNAPSHOT)
    if not os.path.exists(snapshot_path):
        raise SystemExit(f"missing {snapshot_path}; run data_gen.generate_synthetic first")
    if not model_a.load(args.artifacts):
        raise SystemExit("Model A artifacts missing; run training/train_model_a.py first")

    cutoffs = [int(c) for c in args.cutoffs.split(",")]
    end_date = date.fromisoformat(args.end_date)

    snapshot = pd.read_parquet(snapshot_path)
    user_ids = sorted(snapshot["user_id"].unique())
    if args.limit:
        user_ids = user_ids[: args.limit]
    print(f"scoring {len(user_ids)} people at cut-offs {cutoffs}")

    dsn = os.environ.get("SENTINEL_APP_DATABASE_URL")
    if not dsn:
        raise SystemExit("SENTINEL_APP_DATABASE_URL is not set")

    if args.reset:
        # Scores are keyed deterministically so a re-run replaces rather than
        # duplicates. Clearing needs DELETE, which the scoring role does not
        # have and should not — so this uses the owner connection, the same one
        # migrations and seeding use, and never the request path.
        owner = os.environ.get("DATABASE_URL")
        if not owner:
            raise SystemExit("--reset needs DATABASE_URL (owner connection)")
        with psycopg.connect(owner, autocommit=True) as admin:
            admin.execute('DELETE FROM "Alert" WHERE "userId" LIKE %s', ("syn-%",))
            admin.execute('DELETE FROM "Score" WHERE "userId" LIKE %s', ("syn-%",))
        # The queue is an index over the alert table, never a second source of
        # truth. Clearing one without the other would leave officers with a
        # work queue pointing at alerts that no longer exist.
        redis_url = os.environ.get("REDIS_URL")
        if redis_url:
            try:
                import redis as redis_lib

                redis_lib.Redis.from_url(redis_url).delete(ALERT_QUEUE_KEY)
            except Exception as exc:  # noqa: BLE001
                print(f"could not clear the alert queue: {exc}")
        print("cleared previous synthetic scores, alerts and the alert queue")

    by_user = {uid: group for uid, group in snapshot.groupby("user_id", sort=False)}

    written = escalated = 0
    with psycopg.connect(dsn) as conn:
        # SET ROLE, not SET LOCAL: this connection commits periodically, and
        # SET LOCAL reverts to the privilege-less login at the first commit.
        conn.execute("SET ROLE sentinel_scoring")
        for i, user_id in enumerate(user_ids, 1):
            history = by_user[user_id].sort_values("day_index")
            for cutoff in cutoffs:
                window = history[history["day_index"] < cutoff]
                if len(window) < 90:
                    continue

                features = compute_features(window)
                score_a, _band_a, shap_categories = model_a.predict(features)
                result = fusion_model.fuse(score_a, None, None,
                                           shap_categories.model_dump())

                days_back = int(history["day_index"].max() - cutoff + 1)
                computed_at = end_date - timedelta(days=days_back)
                conn.execute(
                    'INSERT INTO "Score" (id, "userId", "computedAt", "scoreA", '
                    '"sentinelScore", band, "confidenceLow", "confidenceHigh", '
                    '"shapCategories", "overrideFired") '
                    # No ON CONFLICT: resolving a conflict target needs
                    # SELECT, which the scoring role deliberately lacks.
                    # Re-runs use --reset instead.
                    'VALUES (%s, %s, %s, %s, %s, %s::"RiskBand", %s, %s, %s::jsonb, %s)',
                    (
                        f"sc-{user_id}-{cutoff}", user_id, computed_at, score_a,
                        result["sentinel_score"], result["band"].value,
                        result["confidence"]["low"], result["confidence"]["high"],
                        json.dumps(result["shap_categories"]), result["override_fired"],
                    ),
                )
                written += 1

            if not args.no_escalate:
                final_band = band_for_score(result["sentinel_score"])
                decision = evaluate(user_id, final_band, conn)
                if decision.escalated:
                    escalated += 1

            if i % 100 == 0:
                conn.commit()
                print(f"  {i}/{len(user_ids)} people, {written} scores, "
                      f"{escalated} alerts", end="\r")
        conn.commit()

    print(f"\nwrote {written} scores; {escalated} alerts created PENDING_REVIEW")
    print("no person was contacted and no commander was notified")


if __name__ == "__main__":
    main()
