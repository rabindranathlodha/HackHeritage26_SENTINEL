-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('PERSONNEL', 'WELFARE_OFFICER', 'COMMANDER', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."RiskBand" AS ENUM ('LOW', 'MODERATE', 'ELEVATED', 'PRIORITY_REVIEW');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL,
    "unitId" TEXT NOT NULL,
    "welfareOfficerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "biometricConsent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "leaveRequested" INTEGER NOT NULL,
    "leaveApproved" INTEGER NOT NULL,
    "leaveDenied" INTEGER NOT NULL,
    "deploymentDays" INTEGER NOT NULL,
    "daysSinceHomePosting" INTEGER NOT NULL,
    "remoteHazardous" BOOLEAN NOT NULL,
    "transfersTrailing12mo" INTEGER NOT NULL,
    "shiftStartStdDev" DOUBLE PRECISION NOT NULL,
    "nightShiftRatio" DOUBLE PRECISION NOT NULL,
    "consecutiveDutyDays" INTEGER NOT NULL,
    "trainingHoursVsAvg" DOUBLE PRECISION NOT NULL,
    "daysSinceIncident" INTEGER NOT NULL,

    CONSTRAINT "HrSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Assessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responses" INTEGER[],
    "nlpContribution" DOUBLE PRECISION,
    "language" TEXT NOT NULL DEFAULT 'en',
    "physioContribution" DOUBLE PRECISION,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Score" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scoreA" DOUBLE PRECISION NOT NULL,
    "scoreB" DOUBLE PRECISION,
    "scoreC" DOUBLE PRECISION,
    "sentinelScore" DOUBLE PRECISION NOT NULL,
    "band" "public"."RiskBand" NOT NULL,
    "confidenceLow" DOUBLE PRECISION NOT NULL,
    "confidenceHigh" DOUBLE PRECISION NOT NULL,
    "shapCategories" JSONB NOT NULL,
    "overrideFired" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "band" "public"."RiskBand" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedBy" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "public"."Role" NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_unitId_idx" ON "public"."User"("unitId");

-- CreateIndex
CREATE INDEX "User_welfareOfficerId_idx" ON "public"."User"("welfareOfficerId");

-- CreateIndex
CREATE INDEX "HrSignal_userId_date_idx" ON "public"."HrSignal"("userId", "date");

-- CreateIndex
CREATE INDEX "Assessment_userId_submittedAt_idx" ON "public"."Assessment"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX "Score_userId_computedAt_idx" ON "public"."Score"("userId", "computedAt");

-- CreateIndex
CREATE INDEX "Alert_userId_status_idx" ON "public"."Alert"("userId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_at_idx" ON "public"."AuditLog"("actorId", "at");

-- AddForeignKey
ALTER TABLE "public"."HrSignal" ADD CONSTRAINT "HrSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Assessment" ADD CONSTRAINT "Assessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
