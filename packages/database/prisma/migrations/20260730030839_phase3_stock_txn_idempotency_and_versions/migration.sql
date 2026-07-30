/*
  Warnings:

  - A unique constraint covering the columns `[idempotency_key]` on the table `stock_transactions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "stock_transactions" ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "transfers" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "stock_transactions_idempotency_key_key" ON "stock_transactions"("idempotency_key");
