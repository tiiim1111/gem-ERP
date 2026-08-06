-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "quantity" DECIMAL(14,4),
ADD COLUMN     "resource_number" TEXT;

-- AlterTable
ALTER TABLE "approval_workflows" ADD COLUMN     "document_subtypes" TEXT[],
ADD COLUMN     "max_quantity" DECIMAL(14,4),
ADD COLUMN     "min_quantity" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "inventory_count_lines" ADD COLUMN     "asset_found" BOOLEAN,
ADD COLUMN     "condition_id" UUID,
ADD COLUMN     "location_confirmed" BOOLEAN,
ADD COLUMN     "recount_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "inventory_count_sessions" ADD COLUMN     "adjustment_idempotency_key" TEXT,
ADD COLUMN     "adjustments_created_at" TIMESTAMP(3),
ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "canceled_at" TIMESTAMP(3),
ADD COLUMN     "canceled_by_id" UUID,
ADD COLUMN     "scope_item_ids" UUID[],
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "link" TEXT;

-- CreateTable
CREATE TABLE "approval_request_steps" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "assignee_user_ids" UUID[],
    "acted_by_id" UUID,
    "acted_at" TIMESTAMP(3),
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_request_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_request_steps_request_id_idx" ON "approval_request_steps"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_request_steps_request_id_sequence_key" ON "approval_request_steps"("request_id", "sequence");

-- CreateIndex
CREATE INDEX "inventory_count_lines_warehouse_id_idx" ON "inventory_count_lines"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_sessions_adjustment_idempotency_key_key" ON "inventory_count_sessions"("adjustment_idempotency_key");

-- AddForeignKey
ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_canceled_by_id_fkey" FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request_steps" ADD CONSTRAINT "approval_request_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request_steps" ADD CONSTRAINT "approval_request_steps_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "approval_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request_steps" ADD CONSTRAINT "approval_request_steps_acted_by_id_fkey" FOREIGN KEY ("acted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

