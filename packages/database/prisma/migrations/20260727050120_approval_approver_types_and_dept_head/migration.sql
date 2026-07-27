/*
  Warnings:

  - Added the required column `approver_type` to the `approval_steps` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ApprovalApproverType" AS ENUM ('ROLE', 'POSITION', 'DEPT_HEAD', 'USER');

-- AlterTable
ALTER TABLE "approval_steps" ADD COLUMN     "approver_position_id" UUID,
ADD COLUMN     "approver_type" "ApprovalApproverType" NOT NULL;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "head_employee_id" UUID;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_employee_id_fkey" FOREIGN KEY ("head_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_position_id_fkey" FOREIGN KEY ("approver_position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
