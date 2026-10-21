-- CreateEnum
CREATE TYPE "HrisSyncTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "HrisSyncStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'REVIEW_REQUIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "HrisSyncIssueSeverity" AS ENUM ('ERROR', 'REVIEW');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "hris_id" TEXT,
ADD COLUMN     "hris_synced_at" TIMESTAMP(3),
ADD COLUMN     "hris_updated_at" TIMESTAMP(3),
ADD COLUMN     "separation_date_inferred" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "hris_sync_runs" (
    "id" UUID NOT NULL,
    "trigger" "HrisSyncTrigger" NOT NULL,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "status" "HrisSyncStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_by_id" UUID,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "company_code" TEXT,
    "snapshot" BOOLEAN,
    "producer_total" INTEGER,
    "pages_fetched" INTEGER,
    "created" INTEGER NOT NULL DEFAULT 0,
    "linked" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hris_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hris_sync_issues" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "severity" "HrisSyncIssueSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "hris_id" TEXT,
    "employee_number" TEXT,
    "employee_id" UUID,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hris_sync_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hris_department_maps" (
    "id" UUID NOT NULL,
    "hris_code" TEXT NOT NULL,
    "hris_name" TEXT,
    "department_id" UUID,
    "auto_suggested" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hris_department_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hris_position_maps" (
    "id" UUID NOT NULL,
    "hris_code" TEXT NOT NULL,
    "hris_name" TEXT,
    "position_id" UUID,
    "auto_suggested" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hris_position_maps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hris_sync_runs_status_idx" ON "hris_sync_runs"("status");

-- CreateIndex
CREATE INDEX "hris_sync_runs_created_at_idx" ON "hris_sync_runs"("created_at");

-- CreateIndex
CREATE INDEX "hris_sync_issues_run_id_idx" ON "hris_sync_issues"("run_id");

-- CreateIndex
CREATE INDEX "hris_sync_issues_code_idx" ON "hris_sync_issues"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hris_department_maps_hris_code_key" ON "hris_department_maps"("hris_code");

-- CreateIndex
CREATE UNIQUE INDEX "hris_position_maps_hris_code_key" ON "hris_position_maps"("hris_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_hris_id_key" ON "employees"("hris_id");

-- CreateIndex
CREATE INDEX "employees_hris_id_idx" ON "employees"("hris_id");

-- AddForeignKey
ALTER TABLE "hris_sync_runs" ADD CONSTRAINT "hris_sync_runs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hris_sync_issues" ADD CONSTRAINT "hris_sync_issues_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "hris_sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hris_department_maps" ADD CONSTRAINT "hris_department_maps_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hris_position_maps" ADD CONSTRAINT "hris_position_maps_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

