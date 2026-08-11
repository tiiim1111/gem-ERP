-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "report_key" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filters" JSONB,
    "include_cost" BOOLEAN NOT NULL DEFAULT false,
    "branch_ids" JSONB,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_by_id" UUID NOT NULL,
    "file_name" TEXT,
    "storage_key" TEXT,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "row_count" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_storage_key_key" ON "export_jobs"("storage_key");

-- CreateIndex
CREATE INDEX "export_jobs_requested_by_id_created_at_idx" ON "export_jobs"("requested_by_id", "created_at");

-- CreateIndex
CREATE INDEX "export_jobs_status_created_at_idx" ON "export_jobs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

