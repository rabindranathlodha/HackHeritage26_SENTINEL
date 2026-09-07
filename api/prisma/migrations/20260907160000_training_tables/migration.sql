-- Bring the training-only tables into migration history.
--
-- `data_gen/generate_synthetic.py` creates these with CREATE TABLE IF NOT
-- EXISTS, which left the database ahead of the migration history and made
-- `prisma migrate dev` report drift and demand a reset. Declaring them here
-- fixes that WITHOUT adding them to schema.prisma — which is the point: they
-- stay absent from the generated client, so no application code path can read
-- the hidden training label even by mistake.

CREATE TABLE IF NOT EXISTS "_ground_truth" (
  "userId"      text PRIMARY KEY,
  "riskBand"    text NOT NULL,
  "latentRisk"  double precision NOT NULL,
  "scenario"    text NOT NULL,
  "unitId"      text NOT NULL,
  "tenureYears" double precision NOT NULL,
  "remoteHazardous" boolean NOT NULL,
  "generatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "_physio_signals" (
  "userId"          text NOT NULL,
  "date"            date NOT NULL,
  "restingHr"       double precision NOT NULL,
  "hrvMs"           double precision NOT NULL,
  "sleepHours"      double precision NOT NULL,
  "sleepEfficiency" double precision NOT NULL,
  PRIMARY KEY ("userId", "date")
);

REVOKE ALL ON "_ground_truth", "_physio_signals" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_scoring') THEN
    EXECUTE 'REVOKE ALL ON "_ground_truth", "_physio_signals" FROM '
            'sentinel_personnel, sentinel_welfare_officer, sentinel_commander, '
            'sentinel_admin, sentinel_scoring';
  END IF;
END
$$;
