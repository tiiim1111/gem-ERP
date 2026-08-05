-- Phase 5 (Maintenance) — additive only.
--
-- maintenance_plans:      version (optimistic concurrency, api-outline 1.6) and
--                         created_by_id (plan-generated WOs are attributed to
--                         the plan's creator by the worker job).
-- maintenance_plan_assets: the covered-asset set behind
--                         PUT /maintenance-plans/:id/assets (api-outline 6.1).
-- maintenance_work_orders: version; hold/cancel reasons; completed_by /
--                         canceled_by attribution; asset_status_before_wo
--                         (cancel reverts the asset to it — status-transitions
--                         §1.1 work-order-canceled); outcome_status (explicit
--                         completion outcome, spec §18); downtime_minutes;
--                         completion_meter_reading (baseline for
--                         meter-interval plans).

-- AlterTable
ALTER TABLE "maintenance_plans" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "maintenance_work_orders" ADD COLUMN     "asset_status_before_wo" "AssetLifecycleStatus",
ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "canceled_by_id" UUID,
ADD COLUMN     "completed_by_id" UUID,
ADD COLUMN     "completion_meter_reading" DECIMAL(14,4),
ADD COLUMN     "downtime_minutes" INTEGER,
ADD COLUMN     "hold_reason" TEXT,
ADD COLUMN     "outcome_status" "AssetLifecycleStatus",
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "maintenance_plan_assets" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_plan_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_plan_assets_asset_id_idx" ON "maintenance_plan_assets"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plan_assets_plan_id_asset_id_key" ON "maintenance_plan_assets"("plan_id", "asset_id");

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plan_assets" ADD CONSTRAINT "maintenance_plan_assets_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "maintenance_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plan_assets" ADD CONSTRAINT "maintenance_plan_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_canceled_by_id_fkey" FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
