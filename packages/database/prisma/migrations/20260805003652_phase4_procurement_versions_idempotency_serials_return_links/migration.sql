-- AlterTable
ALTER TABLE "goods_receipt_lines" ADD COLUMN     "serial_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "stock_transactions" ADD COLUMN     "supplier_return_id" UUID;

-- AlterTable
ALTER TABLE "supplier_return_lines" ADD COLUMN     "storage_location_id" UUID;

-- AlterTable
ALTER TABLE "supplier_returns" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_idempotency_key_key" ON "goods_receipts"("idempotency_key");

-- CreateIndex
CREATE INDEX "stock_transactions_supplier_return_id_idx" ON "stock_transactions"("supplier_return_id");

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_supplier_return_id_fkey" FOREIGN KEY ("supplier_return_id") REFERENCES "supplier_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

