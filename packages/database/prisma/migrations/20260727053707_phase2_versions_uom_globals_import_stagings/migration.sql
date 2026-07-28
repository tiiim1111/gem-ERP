-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "uom_conversions" ALTER COLUMN "item_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "import_stagings" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALIDATED',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "rows" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "result" JSONB,
    "created_by_id" UUID NOT NULL,
    "committed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_stagings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_stagings_type_idx" ON "import_stagings"("type");

-- CreateIndex
CREATE INDEX "import_stagings_created_by_id_idx" ON "import_stagings"("created_by_id");

-- CreateIndex
CREATE INDEX "import_stagings_created_at_idx" ON "import_stagings"("created_at");

-- CreateIndex
CREATE INDEX "uom_conversions_from_uom_id_idx" ON "uom_conversions"("from_uom_id");

-- CreateIndex
CREATE INDEX "uom_conversions_to_uom_id_idx" ON "uom_conversions"("to_uom_id");

-- Global UOM conversions carry item_id NULL. Postgres treats NULLs as distinct
-- inside the composite unique (item_id, from_uom_id, to_uom_id), so a partial
-- unique index is required to keep global (from, to) pairs unique.
CREATE UNIQUE INDEX "uom_conversions_global_from_to_key"
  ON "uom_conversions"("from_uom_id", "to_uom_id")
  WHERE "item_id" IS NULL;
