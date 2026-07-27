-- CreateEnum
CREATE TYPE "BusinessCategory" AS ENUM ('SERIALIZED_ASSET', 'CONSUMABLE', 'BULK_NON_CONSUMABLE');

-- CreateEnum
CREATE TYPE "TrackingMethod" AS ENUM ('SERIAL', 'QUANTITY', 'LOT');

-- CreateEnum
CREATE TYPE "AssetLifecycleStatus" AS ENUM ('DRAFT', 'AVAILABLE', 'RESERVED', 'ASSIGNED', 'IN_TRANSFER', 'UNDER_INSPECTION', 'UNDER_MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "StockTransactionType" AS ENUM ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'NON_PURCHASE_RECEIPT', 'ISSUE_TO_EMPLOYEE', 'ISSUE_TO_DEPARTMENT', 'RETURN_FROM_EMPLOYEE', 'RETURN_TO_SUPPLIER', 'LOCATION_TRANSFER', 'INTER_BRANCH_TRANSFER_OUT', 'INTER_BRANCH_TRANSFER_IN', 'ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE', 'MAINTENANCE_ISSUE', 'DISPOSAL', 'REVERSAL');

-- CreateEnum
CREATE TYPE "StockDocumentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED', 'CANCELED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CANCELED', 'CLOSED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELED', 'REVERSED');

-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('LOCATION', 'INTRA_BRANCH', 'INTER_BRANCH');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "InventoryCountType" AS ENUM ('FULL', 'CYCLE');

-- CreateEnum
CREATE TYPE "InventoryCountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CountLineFlag" AS ENUM ('MATCHED', 'VARIANCE', 'MISSING', 'UNEXPECTED', 'DUPLICATE', 'MISPLACED');

-- CreateEnum
CREATE TYPE "MaintenanceWorkOrderStatus" AS ENUM ('DRAFT', 'OPEN', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'AWAITING_PARTS', 'AWAITING_VENDOR', 'COMPLETED', 'VERIFIED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('APPROVE', 'REJECT', 'RETURN', 'CANCEL', 'COMMENT');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'SEPARATED');

-- CreateEnum
CREATE TYPE "AssetAssignmentStatus" AS ENUM ('PENDING_ACKNOWLEDGMENT', 'ACTIVE', 'RETURNED', 'LOST', 'CANCELED');

-- CreateEnum
CREATE TYPE "AcknowledgmentType" AS ENUM ('ISSUE', 'RETURN');

-- CreateEnum
CREATE TYPE "PermissionOverrideEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'FULFILLED', 'CANCELED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
    "currency_code" TEXT NOT NULL DEFAULT 'PHP',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_access" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_branch_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "effect" "PermissionOverrideEffect" NOT NULL,
    "reason" TEXT,
    "created_by_id" UUID,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "region" TEXT,
    "phone" TEXT,
    "timezone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_receiving_location_id" UUID,
    "default_issue_location_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_locations" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location_type" TEXT,
    "barcode" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "branch_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "employee_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT NOT NULL,
    "display_name" TEXT,
    "work_email" TEXT,
    "work_phone" TEXT,
    "branch_id" UUID NOT NULL,
    "department_id" UUID,
    "position_id" UUID,
    "supervisor_id" UUID,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE,
    "separation_date" DATE,
    "photo_url" TEXT,
    "notes" TEXT,
    "user_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_subcategories" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_subcategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uom_conversions" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "from_uom_id" UUID NOT NULL,
    "to_uom_id" UUID NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uom_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "business_category" "BusinessCategory" NOT NULL,
    "tracking_method" "TrackingMethod" NOT NULL,
    "category_id" UUID,
    "subcategory_id" UUID,
    "brand_id" UUID,
    "manufacturer_id" UUID,
    "model" TEXT,
    "base_uom_id" UUID NOT NULL,
    "purchase_uom_id" UUID,
    "issue_uom_id" UUID,
    "default_supplier_id" UUID,
    "standard_cost" DECIMAL(14,2),
    "last_purchase_cost" DECIMAL(14,2),
    "is_lot_tracked" BOOLEAN NOT NULL DEFAULT false,
    "is_expiry_tracked" BOOLEAN NOT NULL DEFAULT false,
    "requires_serial_number" BOOLEAN NOT NULL DEFAULT false,
    "is_maintainable" BOOLEAN NOT NULL DEFAULT false,
    "image_url" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_barcodes" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "barcode_type" TEXT,
    "uom_id" UUID,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN DEFAULT true,
    "deactivated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_warehouse_settings" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "reorder_level" DECIMAL(14,4),
    "reorder_quantity" DECIMAL(14,4),
    "min_quantity" DECIMAL(14,4),
    "max_quantity" DECIMAL(14,4),
    "default_storage_location_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_warehouse_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_lots" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_number" TEXT NOT NULL,
    "supplier_lot_number" TEXT,
    "manufacture_date" DATE,
    "expiry_date" DATE,
    "barcode" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transactions" (
    "id" UUID NOT NULL,
    "transaction_number" TEXT NOT NULL,
    "type" "StockTransactionType" NOT NULL,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "transaction_date" DATE NOT NULL,
    "branch_id" UUID NOT NULL,
    "source_branch_id" UUID,
    "destination_branch_id" UUID,
    "source_warehouse_id" UUID,
    "destination_warehouse_id" UUID,
    "employee_id" UUID,
    "department_id" UUID,
    "supplier_id" UUID,
    "purchase_order_id" UUID,
    "goods_receipt_id" UUID,
    "transfer_id" UUID,
    "maintenance_work_order_id" UUID,
    "count_session_id" UUID,
    "project_ref" TEXT,
    "reason_id" UUID,
    "notes" TEXT,
    "reversal_of_id" UUID,
    "created_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "posted_by_id" UUID,
    "posted_at" TIMESTAMP(3),
    "canceled_by_id" UUID,
    "canceled_at" TIMESTAMP(3),
    "reversed_by_id" UUID,
    "reversed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transaction_lines" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_id" UUID,
    "asset_id" UUID,
    "source_location_id" UUID,
    "destination_location_id" UUID,
    "entered_uom_id" UUID NOT NULL,
    "entered_quantity" DECIMAL(14,4) NOT NULL,
    "base_quantity" DECIMAL(14,4) NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "total_cost" DECIMAL(14,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transaction_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "transaction_line_id" UUID,
    "item_id" UUID NOT NULL,
    "lot_id" UUID,
    "asset_id" UUID,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "storage_location_id" UUID,
    "quantity_delta" DECIMAL(14,4) NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "posted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "storage_location_id" UUID,
    "lot_id" UUID,
    "on_hand_qty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "reserved_qty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "in_transit_qty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "storage_location_id" UUID,
    "lot_id" UUID,
    "quantity" DECIMAL(14,4) NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "transfer_id" UUID,
    "purpose" TEXT,
    "created_by_id" UUID,
    "expires_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "asset_tag" TEXT NOT NULL,
    "scan_token" TEXT NOT NULL,
    "serial_number" TEXT,
    "item_id" UUID NOT NULL,
    "status" "AssetLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "condition_id" UUID,
    "criticality_id" UUID,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID,
    "storage_location_id" UUID,
    "custodian_employee_id" UUID,
    "department_id" UUID,
    "acquisition_date" DATE,
    "acquisition_cost" DECIMAL(14,2),
    "supplier_id" UUID,
    "purchase_order_id" UUID,
    "goods_receipt_line_id" UUID,
    "warranty_start_date" DATE,
    "warranty_end_date" DATE,
    "maintenance_required" BOOLEAN NOT NULL DEFAULT false,
    "last_inspection_at" TIMESTAMP(3),
    "next_maintenance_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "disposed_at" TIMESTAMP(3),
    "disposal_method_id" UUID,
    "disposal_notes" TEXT,
    "notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_assignments" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "status" "AssetAssignmentStatus" NOT NULL DEFAULT 'PENDING_ACKNOWLEDGMENT',
    "employee_id" UUID,
    "department_id" UUID,
    "location_id" UUID,
    "project_ref" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "expected_return_at" TIMESTAMP(3),
    "condition_at_issue_id" UUID,
    "issue_notes" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "return_received_by_id" UUID,
    "condition_at_return_id" UUID,
    "return_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_movements" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "moved_at" TIMESTAMP(3) NOT NULL,
    "from_branch_id" UUID,
    "to_branch_id" UUID,
    "from_warehouse_id" UUID,
    "to_warehouse_id" UUID,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "from_employee_id" UUID,
    "to_employee_id" UUID,
    "transfer_id" UUID,
    "assignment_id" UUID,
    "reason_id" UUID,
    "moved_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_condition_history" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "condition_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "recorded_by_id" UUID,
    "source" TEXT,
    "maintenance_work_order_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_condition_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_status_history" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "from_status" "AssetLifecycleStatus",
    "to_status" "AssetLifecycleStatus" NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL,
    "changed_by_id" UUID,
    "reason_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_acknowledgments" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" "AcknowledgmentType" NOT NULL,
    "acknowledged_at" TIMESTAMP(3) NOT NULL,
    "acknowledged_by_user_id" UUID,
    "method" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_acknowledgments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_meter_readings" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "meter_type" TEXT,
    "reading_value" DECIMAL(14,4) NOT NULL,
    "reading_at" TIMESTAMP(3) NOT NULL,
    "recorded_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT DEFAULT 'PH',
    "tax_id" TEXT,
    "payment_terms" TEXT,
    "category_id" UUID,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_contacts" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "destination_warehouse_id" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE NOT NULL,
    "expected_delivery_date" DATE,
    "currency_code" TEXT NOT NULL DEFAULT 'PHP',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "terms" TEXT,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "canceled_by_id" UUID,
    "canceled_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "description" TEXT,
    "uom_id" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL,
    "received_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "canceled_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "receipt_date" DATE NOT NULL,
    "supplier_reference" TEXT,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "posted_by_id" UUID,
    "posted_at" TIMESTAMP(3),
    "canceled_by_id" UUID,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "uom_id" UUID NOT NULL,
    "received_quantity" DECIMAL(14,4) NOT NULL,
    "base_quantity" DECIMAL(14,4) NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "lot_id" UUID,
    "storage_location_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" UUID NOT NULL,
    "return_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "goods_receipt_id" UUID,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "return_date" DATE NOT NULL,
    "reason_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "posted_by_id" UUID,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_lines" (
    "id" UUID NOT NULL,
    "supplier_return_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_id" UUID,
    "uom_id" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "base_quantity" DECIMAL(14,4) NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "type" "TransferType" NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "source_branch_id" UUID NOT NULL,
    "source_warehouse_id" UUID NOT NULL,
    "source_location_id" UUID,
    "destination_branch_id" UUID NOT NULL,
    "destination_warehouse_id" UUID,
    "destination_location_id" UUID,
    "transfer_date" DATE NOT NULL,
    "reason_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "dispatched_by_id" UUID,
    "dispatched_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "canceled_by_id" UUID,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_lines" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID,
    "asset_id" UUID,
    "lot_id" UUID,
    "uom_id" UUID,
    "quantity" DECIMAL(14,4),
    "base_quantity" DECIMAL(14,4),
    "dispatched_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "received_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "damaged_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "short_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "rejected_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_receipts" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "received_by_id" UUID NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_receipt_lines" (
    "id" UUID NOT NULL,
    "transfer_receipt_id" UUID NOT NULL,
    "transfer_line_id" UUID NOT NULL,
    "received_quantity" DECIMAL(14,4) NOT NULL,
    "damaged_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "short_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "rejected_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "condition_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_sessions" (
    "id" UUID NOT NULL,
    "count_number" TEXT NOT NULL,
    "type" "InventoryCountType" NOT NULL,
    "status" "InventoryCountStatus" NOT NULL DEFAULT 'DRAFT',
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID,
    "storage_location_id" UUID,
    "category_id" UUID,
    "is_blind" BOOLEAN NOT NULL DEFAULT false,
    "snapshot_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_count_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_lines" (
    "id" UUID NOT NULL,
    "count_session_id" UUID NOT NULL,
    "item_id" UUID,
    "asset_id" UUID,
    "lot_id" UUID,
    "storage_location_id" UUID,
    "uom_id" UUID,
    "expected_quantity" DECIMAL(14,4),
    "counted_quantity" DECIMAL(14,4),
    "recount_quantity" DECIMAL(14,4),
    "variance_quantity" DECIMAL(14,4),
    "flag" "CountLineFlag",
    "counted_by_id" UUID,
    "counted_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "asset_id" UUID,
    "item_id" UUID,
    "maintenance_type_id" UUID NOT NULL,
    "interval_days" INTEGER,
    "meter_interval" DECIMAL(14,4),
    "meter_type" TEXT,
    "schedule_cron" TEXT,
    "assigned_team" TEXT,
    "vendor_id" UUID,
    "estimated_duration_hours" DECIMAL(14,2),
    "estimated_cost" DECIMAL(14,2),
    "reminder_lead_days" INTEGER,
    "next_due_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plan_tasks" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_plan_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_work_orders" (
    "id" UUID NOT NULL,
    "work_order_number" TEXT NOT NULL,
    "asset_id" UUID NOT NULL,
    "plan_id" UUID,
    "branch_id" UUID NOT NULL,
    "maintenance_type_id" UUID NOT NULL,
    "priority_id" UUID,
    "status" "MaintenanceWorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "problem_description" TEXT,
    "reported_by_id" UUID,
    "reported_at" TIMESTAMP(3),
    "assigned_to_employee_id" UUID,
    "assigned_vendor_id" UUID,
    "assigned_team" TEXT,
    "scheduled_start_at" TIMESTAMP(3),
    "scheduled_end_at" TIMESTAMP(3),
    "actual_start_at" TIMESTAMP(3),
    "actual_end_at" TIMESTAMP(3),
    "diagnosis" TEXT,
    "action_taken" TEXT,
    "resolution" TEXT,
    "labor_cost" DECIMAL(14,2),
    "parts_cost" DECIMAL(14,2),
    "external_cost" DECIMAL(14,2),
    "total_cost" DECIMAL(14,2),
    "downtime_hours" DECIMAL(14,2),
    "completion_condition_id" UUID,
    "next_maintenance_at" TIMESTAMP(3),
    "verified_by_id" UUID,
    "verified_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_work_order_tasks" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "plan_task_id" UUID,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "completed_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_work_order_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_parts" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_id" UUID,
    "uom_id" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "base_quantity" DECIMAL(14,4),
    "unit_cost" DECIMAL(14,2),
    "total_cost" DECIMAL(14,2),
    "stock_transaction_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_workflows" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "resource_type" TEXT NOT NULL,
    "branch_id" UUID,
    "min_amount" DECIMAL(14,2),
    "max_amount" DECIMAL(14,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT,
    "approver_role_id" UUID,
    "approver_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "current_step_id" UUID,
    "amount" DECIMAL(14,2),
    "branch_id" UUID,
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_actions" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "step_id" UUID,
    "actor_id" UUID NOT NULL,
    "action" "ApprovalActionType" NOT NULL,
    "comment" TEXT,
    "delegated_for_id" UUID,
    "acted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegations" (
    "id" UUID NOT NULL,
    "delegator_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" UUID,
    "branch_id" UUID,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT,
    "document_type_id" UUID,
    "branch_id" UUID,
    "uploaded_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "branch_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_values" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "branch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lookup_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_counters" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE INDEX "user_branch_access_branch_id_idx" ON "user_branch_access"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_branch_access_user_id_branch_id_key" ON "user_branch_access"("user_id", "branch_id");

-- CreateIndex
CREATE INDEX "user_permission_overrides_permission_id_idx" ON "user_permission_overrides"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_permission_overrides_user_id_permission_id_key" ON "user_permission_overrides"("user_id", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE INDEX "branches_organization_id_idx" ON "branches"("organization_id");

-- CreateIndex
CREATE INDEX "branches_is_active_idx" ON "branches"("is_active");

-- CreateIndex
CREATE INDEX "warehouses_branch_id_idx" ON "warehouses"("branch_id");

-- CreateIndex
CREATE INDEX "warehouses_is_active_idx" ON "warehouses"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_branch_id_code_key" ON "warehouses"("branch_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_barcode_key" ON "storage_locations"("barcode");

-- CreateIndex
CREATE INDEX "storage_locations_warehouse_id_idx" ON "storage_locations"("warehouse_id");

-- CreateIndex
CREATE INDEX "storage_locations_parent_id_idx" ON "storage_locations"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_warehouse_id_code_key" ON "storage_locations"("warehouse_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE INDEX "departments_branch_id_idx" ON "departments"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "positions_code_key" ON "positions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_number_key" ON "employees"("employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "employees_work_email_key" ON "employees"("work_email");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_branch_id_idx" ON "employees"("branch_id");

-- CreateIndex
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_last_name_first_name_idx" ON "employees"("last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "item_categories_code_key" ON "item_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "item_subcategories_category_id_code_key" ON "item_subcategories"("category_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "brands_code_key" ON "brands"("code");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_code_key" ON "manufacturers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_code_key" ON "units_of_measure"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uom_conversions_item_id_from_uom_id_to_uom_id_key" ON "uom_conversions"("item_id", "from_uom_id", "to_uom_id");

-- CreateIndex
CREATE UNIQUE INDEX "items_sku_key" ON "items"("sku");

-- CreateIndex
CREATE INDEX "items_business_category_idx" ON "items"("business_category");

-- CreateIndex
CREATE INDEX "items_tracking_method_idx" ON "items"("tracking_method");

-- CreateIndex
CREATE INDEX "items_category_id_idx" ON "items"("category_id");

-- CreateIndex
CREATE INDEX "items_default_supplier_id_idx" ON "items"("default_supplier_id");

-- CreateIndex
CREATE INDEX "items_is_active_idx" ON "items"("is_active");

-- CreateIndex
CREATE INDEX "items_name_idx" ON "items"("name");

-- CreateIndex
CREATE INDEX "item_barcodes_item_id_idx" ON "item_barcodes"("item_id");

-- CreateIndex
CREATE INDEX "item_barcodes_barcode_idx" ON "item_barcodes"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "item_barcodes_barcode_is_active_key" ON "item_barcodes"("barcode", "is_active");

-- CreateIndex
CREATE INDEX "item_warehouse_settings_warehouse_id_idx" ON "item_warehouse_settings"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_warehouse_settings_item_id_warehouse_id_key" ON "item_warehouse_settings"("item_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lots_barcode_key" ON "inventory_lots"("barcode");

-- CreateIndex
CREATE INDEX "inventory_lots_expiry_date_idx" ON "inventory_lots"("expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lots_item_id_lot_number_key" ON "inventory_lots"("item_id", "lot_number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transactions_transaction_number_key" ON "stock_transactions"("transaction_number");

-- CreateIndex
CREATE INDEX "stock_transactions_type_idx" ON "stock_transactions"("type");

-- CreateIndex
CREATE INDEX "stock_transactions_status_idx" ON "stock_transactions"("status");

-- CreateIndex
CREATE INDEX "stock_transactions_transaction_date_idx" ON "stock_transactions"("transaction_date");

-- CreateIndex
CREATE INDEX "stock_transactions_branch_id_idx" ON "stock_transactions"("branch_id");

-- CreateIndex
CREATE INDEX "stock_transactions_posted_at_idx" ON "stock_transactions"("posted_at");

-- CreateIndex
CREATE INDEX "stock_transactions_supplier_id_idx" ON "stock_transactions"("supplier_id");

-- CreateIndex
CREATE INDEX "stock_transactions_purchase_order_id_idx" ON "stock_transactions"("purchase_order_id");

-- CreateIndex
CREATE INDEX "stock_transactions_goods_receipt_id_idx" ON "stock_transactions"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "stock_transactions_transfer_id_idx" ON "stock_transactions"("transfer_id");

-- CreateIndex
CREATE INDEX "stock_transactions_maintenance_work_order_id_idx" ON "stock_transactions"("maintenance_work_order_id");

-- CreateIndex
CREATE INDEX "stock_transactions_count_session_id_idx" ON "stock_transactions"("count_session_id");

-- CreateIndex
CREATE INDEX "stock_transactions_employee_id_idx" ON "stock_transactions"("employee_id");

-- CreateIndex
CREATE INDEX "stock_transaction_lines_item_id_idx" ON "stock_transaction_lines"("item_id");

-- CreateIndex
CREATE INDEX "stock_transaction_lines_lot_id_idx" ON "stock_transaction_lines"("lot_id");

-- CreateIndex
CREATE INDEX "stock_transaction_lines_asset_id_idx" ON "stock_transaction_lines"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transaction_lines_transaction_id_line_number_key" ON "stock_transaction_lines"("transaction_id", "line_number");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_item_id_warehouse_id_idx" ON "stock_ledger_entries"("item_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_item_id_branch_id_idx" ON "stock_ledger_entries"("item_id", "branch_id");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_warehouse_id_storage_location_id_idx" ON "stock_ledger_entries"("warehouse_id", "storage_location_id");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_transaction_id_idx" ON "stock_ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_lot_id_idx" ON "stock_ledger_entries"("lot_id");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_asset_id_idx" ON "stock_ledger_entries"("asset_id");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_posted_at_idx" ON "stock_ledger_entries"("posted_at");

-- CreateIndex
CREATE INDEX "stock_balances_warehouse_id_idx" ON "stock_balances"("warehouse_id");

-- CreateIndex
CREATE INDEX "stock_balances_branch_id_idx" ON "stock_balances"("branch_id");

-- CreateIndex
CREATE INDEX "stock_balances_item_id_idx" ON "stock_balances"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_item_id_warehouse_id_storage_location_id_lot_key" ON "stock_balances"("item_id", "warehouse_id", "storage_location_id", "lot_id");

-- CreateIndex
CREATE INDEX "stock_reservations_item_id_warehouse_id_idx" ON "stock_reservations"("item_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_reservations_status_idx" ON "stock_reservations"("status");

-- CreateIndex
CREATE INDEX "stock_reservations_transfer_id_idx" ON "stock_reservations"("transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_asset_tag_key" ON "assets"("asset_tag");

-- CreateIndex
CREATE UNIQUE INDEX "assets_scan_token_key" ON "assets"("scan_token");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE INDEX "assets_branch_id_idx" ON "assets"("branch_id");

-- CreateIndex
CREATE INDEX "assets_warehouse_id_idx" ON "assets"("warehouse_id");

-- CreateIndex
CREATE INDEX "assets_custodian_employee_id_idx" ON "assets"("custodian_employee_id");

-- CreateIndex
CREATE INDEX "assets_item_id_idx" ON "assets"("item_id");

-- CreateIndex
CREATE INDEX "assets_next_maintenance_at_idx" ON "assets"("next_maintenance_at");

-- CreateIndex
CREATE INDEX "assets_warranty_end_date_idx" ON "assets"("warranty_end_date");

-- CreateIndex
CREATE UNIQUE INDEX "assets_item_id_serial_number_key" ON "assets"("item_id", "serial_number");

-- CreateIndex
CREATE INDEX "asset_assignments_asset_id_idx" ON "asset_assignments"("asset_id");

-- CreateIndex
CREATE INDEX "asset_assignments_employee_id_idx" ON "asset_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "asset_assignments_status_idx" ON "asset_assignments"("status");

-- CreateIndex
CREATE INDEX "asset_assignments_expected_return_at_idx" ON "asset_assignments"("expected_return_at");

-- CreateIndex
CREATE INDEX "asset_movements_asset_id_idx" ON "asset_movements"("asset_id");

-- CreateIndex
CREATE INDEX "asset_movements_moved_at_idx" ON "asset_movements"("moved_at");

-- CreateIndex
CREATE INDEX "asset_movements_transfer_id_idx" ON "asset_movements"("transfer_id");

-- CreateIndex
CREATE INDEX "asset_condition_history_asset_id_idx" ON "asset_condition_history"("asset_id");

-- CreateIndex
CREATE INDEX "asset_condition_history_recorded_at_idx" ON "asset_condition_history"("recorded_at");

-- CreateIndex
CREATE INDEX "asset_status_history_asset_id_idx" ON "asset_status_history"("asset_id");

-- CreateIndex
CREATE INDEX "asset_status_history_changed_at_idx" ON "asset_status_history"("changed_at");

-- CreateIndex
CREATE INDEX "asset_acknowledgments_assignment_id_idx" ON "asset_acknowledgments"("assignment_id");

-- CreateIndex
CREATE INDEX "asset_acknowledgments_asset_id_idx" ON "asset_acknowledgments"("asset_id");

-- CreateIndex
CREATE INDEX "asset_acknowledgments_employee_id_idx" ON "asset_acknowledgments"("employee_id");

-- CreateIndex
CREATE INDEX "asset_meter_readings_asset_id_reading_at_idx" ON "asset_meter_readings"("asset_id", "reading_at");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE INDEX "suppliers_is_active_idx" ON "suppliers"("is_active");

-- CreateIndex
CREATE INDEX "supplier_contacts_supplier_id_idx" ON "supplier_contacts"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_branch_id_idx" ON "purchase_orders"("branch_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_orders_order_date_idx" ON "purchase_orders"("order_date");

-- CreateIndex
CREATE INDEX "purchase_order_lines_item_id_idx" ON "purchase_order_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_line_number_key" ON "purchase_order_lines"("purchase_order_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_receipt_number_key" ON "goods_receipts"("receipt_number");

-- CreateIndex
CREATE INDEX "goods_receipts_purchase_order_id_idx" ON "goods_receipts"("purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipts_branch_id_idx" ON "goods_receipts"("branch_id");

-- CreateIndex
CREATE INDEX "goods_receipts_status_idx" ON "goods_receipts"("status");

-- CreateIndex
CREATE INDEX "goods_receipts_receipt_date_idx" ON "goods_receipts"("receipt_date");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_purchase_order_line_id_idx" ON "goods_receipt_lines"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_item_id_idx" ON "goods_receipt_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_lines_goods_receipt_id_line_number_key" ON "goods_receipt_lines"("goods_receipt_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_return_number_key" ON "supplier_returns"("return_number");

-- CreateIndex
CREATE INDEX "supplier_returns_supplier_id_idx" ON "supplier_returns"("supplier_id");

-- CreateIndex
CREATE INDEX "supplier_returns_branch_id_idx" ON "supplier_returns"("branch_id");

-- CreateIndex
CREATE INDEX "supplier_returns_status_idx" ON "supplier_returns"("status");

-- CreateIndex
CREATE INDEX "supplier_return_lines_item_id_idx" ON "supplier_return_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_return_lines_supplier_return_id_line_number_key" ON "supplier_return_lines"("supplier_return_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_transfer_number_key" ON "transfers"("transfer_number");

-- CreateIndex
CREATE INDEX "transfers_status_idx" ON "transfers"("status");

-- CreateIndex
CREATE INDEX "transfers_source_branch_id_idx" ON "transfers"("source_branch_id");

-- CreateIndex
CREATE INDEX "transfers_destination_branch_id_idx" ON "transfers"("destination_branch_id");

-- CreateIndex
CREATE INDEX "transfers_transfer_date_idx" ON "transfers"("transfer_date");

-- CreateIndex
CREATE INDEX "transfer_lines_item_id_idx" ON "transfer_lines"("item_id");

-- CreateIndex
CREATE INDEX "transfer_lines_asset_id_idx" ON "transfer_lines"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_lines_transfer_id_line_number_key" ON "transfer_lines"("transfer_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_receipts_receipt_number_key" ON "transfer_receipts"("receipt_number");

-- CreateIndex
CREATE INDEX "transfer_receipts_transfer_id_idx" ON "transfer_receipts"("transfer_id");

-- CreateIndex
CREATE INDEX "transfer_receipt_lines_transfer_line_id_idx" ON "transfer_receipt_lines"("transfer_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_sessions_count_number_key" ON "inventory_count_sessions"("count_number");

-- CreateIndex
CREATE INDEX "inventory_count_sessions_branch_id_idx" ON "inventory_count_sessions"("branch_id");

-- CreateIndex
CREATE INDEX "inventory_count_sessions_warehouse_id_idx" ON "inventory_count_sessions"("warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_count_sessions_status_idx" ON "inventory_count_sessions"("status");

-- CreateIndex
CREATE INDEX "inventory_count_lines_count_session_id_idx" ON "inventory_count_lines"("count_session_id");

-- CreateIndex
CREATE INDEX "inventory_count_lines_item_id_idx" ON "inventory_count_lines"("item_id");

-- CreateIndex
CREATE INDEX "inventory_count_lines_asset_id_idx" ON "inventory_count_lines"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plans_code_key" ON "maintenance_plans"("code");

-- CreateIndex
CREATE INDEX "maintenance_plans_asset_id_idx" ON "maintenance_plans"("asset_id");

-- CreateIndex
CREATE INDEX "maintenance_plans_item_id_idx" ON "maintenance_plans"("item_id");

-- CreateIndex
CREATE INDEX "maintenance_plans_is_active_idx" ON "maintenance_plans"("is_active");

-- CreateIndex
CREATE INDEX "maintenance_plans_next_due_at_idx" ON "maintenance_plans"("next_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plan_tasks_plan_id_sequence_key" ON "maintenance_plan_tasks"("plan_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_work_orders_work_order_number_key" ON "maintenance_work_orders"("work_order_number");

-- CreateIndex
CREATE INDEX "maintenance_work_orders_asset_id_idx" ON "maintenance_work_orders"("asset_id");

-- CreateIndex
CREATE INDEX "maintenance_work_orders_branch_id_idx" ON "maintenance_work_orders"("branch_id");

-- CreateIndex
CREATE INDEX "maintenance_work_orders_status_idx" ON "maintenance_work_orders"("status");

-- CreateIndex
CREATE INDEX "maintenance_work_orders_scheduled_start_at_idx" ON "maintenance_work_orders"("scheduled_start_at");

-- CreateIndex
CREATE INDEX "maintenance_work_orders_assigned_to_employee_id_idx" ON "maintenance_work_orders"("assigned_to_employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_work_order_tasks_work_order_id_sequence_key" ON "maintenance_work_order_tasks"("work_order_id", "sequence");

-- CreateIndex
CREATE INDEX "maintenance_parts_work_order_id_idx" ON "maintenance_parts"("work_order_id");

-- CreateIndex
CREATE INDEX "maintenance_parts_item_id_idx" ON "maintenance_parts"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_workflows_code_key" ON "approval_workflows"("code");

-- CreateIndex
CREATE INDEX "approval_workflows_resource_type_idx" ON "approval_workflows"("resource_type");

-- CreateIndex
CREATE INDEX "approval_workflows_branch_id_idx" ON "approval_workflows"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_workflow_id_sequence_key" ON "approval_steps"("workflow_id", "sequence");

-- CreateIndex
CREATE INDEX "approval_requests_resource_type_resource_id_idx" ON "approval_requests"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");

-- CreateIndex
CREATE INDEX "approval_requests_requested_by_id_idx" ON "approval_requests"("requested_by_id");

-- CreateIndex
CREATE INDEX "approval_actions_request_id_idx" ON "approval_actions"("request_id");

-- CreateIndex
CREATE INDEX "approval_actions_actor_id_idx" ON "approval_actions"("actor_id");

-- CreateIndex
CREATE INDEX "approval_delegations_delegator_id_idx" ON "approval_delegations"("delegator_id");

-- CreateIndex
CREATE INDEX "approval_delegations_delegate_id_idx" ON "approval_delegations"("delegate_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_read_at_idx" ON "notifications"("recipient_user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipient_user_id_dedupe_key_key" ON "notifications"("recipient_user_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_resource_type_resource_id_idx" ON "attachments"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "attachments_branch_id_idx" ON "attachments"("branch_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_branch_id_idx" ON "audit_logs"("branch_id");

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "lookup_values_category_is_active_idx" ON "lookup_values"("category", "is_active");

-- CreateIndex
CREATE INDEX "lookup_values_branch_id_idx" ON "lookup_values"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_values_category_code_key" ON "lookup_values"("category", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_counters_key_key" ON "sequence_counters"("key");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_default_receiving_location_id_fkey" FOREIGN KEY ("default_receiving_location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_default_issue_location_id_fkey" FOREIGN KEY ("default_issue_location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_subcategories" ADD CONSTRAINT "item_subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_from_uom_id_fkey" FOREIGN KEY ("from_uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_to_uom_id_fkey" FOREIGN KEY ("to_uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "item_subcategories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_base_uom_id_fkey" FOREIGN KEY ("base_uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_purchase_uom_id_fkey" FOREIGN KEY ("purchase_uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_issue_uom_id_fkey" FOREIGN KEY ("issue_uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_default_supplier_id_fkey" FOREIGN KEY ("default_supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_warehouse_settings" ADD CONSTRAINT "item_warehouse_settings_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_warehouse_settings" ADD CONSTRAINT "item_warehouse_settings_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_warehouse_settings" ADD CONSTRAINT "item_warehouse_settings_default_storage_location_id_fkey" FOREIGN KEY ("default_storage_location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_source_branch_id_fkey" FOREIGN KEY ("source_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_destination_branch_id_fkey" FOREIGN KEY ("destination_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_source_warehouse_id_fkey" FOREIGN KEY ("source_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_destination_warehouse_id_fkey" FOREIGN KEY ("destination_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_maintenance_work_order_id_fkey" FOREIGN KEY ("maintenance_work_order_id") REFERENCES "maintenance_work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_count_session_id_fkey" FOREIGN KEY ("count_session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "stock_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_canceled_by_id_fkey" FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transaction_lines" ADD CONSTRAINT "stock_transaction_lines_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "stock_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transaction_lines" ADD CONSTRAINT "stock_transaction_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transaction_lines" ADD CONSTRAINT "stock_transaction_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transaction_lines" ADD CONSTRAINT "stock_transaction_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transaction_lines" ADD CONSTRAINT "stock_transaction_lines_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transaction_lines" ADD CONSTRAINT "stock_transaction_lines_destination_location_id_fkey" FOREIGN KEY ("destination_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transaction_lines" ADD CONSTRAINT "stock_transaction_lines_entered_uom_id_fkey" FOREIGN KEY ("entered_uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "stock_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_transaction_line_id_fkey" FOREIGN KEY ("transaction_line_id") REFERENCES "stock_transaction_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_criticality_id_fkey" FOREIGN KEY ("criticality_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_disposal_method_id_fkey" FOREIGN KEY ("disposal_method_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_custodian_employee_id_fkey" FOREIGN KEY ("custodian_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_goods_receipt_line_id_fkey" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "goods_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_return_received_by_id_fkey" FOREIGN KEY ("return_received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_condition_at_issue_id_fkey" FOREIGN KEY ("condition_at_issue_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_condition_at_return_id_fkey" FOREIGN KEY ("condition_at_return_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_from_employee_id_fkey" FOREIGN KEY ("from_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_to_employee_id_fkey" FOREIGN KEY ("to_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "asset_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_moved_by_id_fkey" FOREIGN KEY ("moved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_condition_history" ADD CONSTRAINT "asset_condition_history_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_condition_history" ADD CONSTRAINT "asset_condition_history_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_condition_history" ADD CONSTRAINT "asset_condition_history_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_condition_history" ADD CONSTRAINT "asset_condition_history_maintenance_work_order_id_fkey" FOREIGN KEY ("maintenance_work_order_id") REFERENCES "maintenance_work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_status_history" ADD CONSTRAINT "asset_status_history_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_status_history" ADD CONSTRAINT "asset_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_status_history" ADD CONSTRAINT "asset_status_history_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_acknowledgments" ADD CONSTRAINT "asset_acknowledgments_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "asset_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_acknowledgments" ADD CONSTRAINT "asset_acknowledgments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_acknowledgments" ADD CONSTRAINT "asset_acknowledgments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_acknowledgments" ADD CONSTRAINT "asset_acknowledgments_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_meter_readings" ADD CONSTRAINT "asset_meter_readings_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_meter_readings" ADD CONSTRAINT "asset_meter_readings_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_destination_warehouse_id_fkey" FOREIGN KEY ("destination_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_canceled_by_id_fkey" FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_canceled_by_id_fkey" FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_supplier_return_id_fkey" FOREIGN KEY ("supplier_return_id") REFERENCES "supplier_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_branch_id_fkey" FOREIGN KEY ("source_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_warehouse_id_fkey" FOREIGN KEY ("source_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_branch_id_fkey" FOREIGN KEY ("destination_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_warehouse_id_fkey" FOREIGN KEY ("destination_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_location_id_fkey" FOREIGN KEY ("destination_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_dispatched_by_id_fkey" FOREIGN KEY ("dispatched_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_canceled_by_id_fkey" FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_transfer_receipt_id_fkey" FOREIGN KEY ("transfer_receipt_id") REFERENCES "transfer_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_transfer_line_id_fkey" FOREIGN KEY ("transfer_line_id") REFERENCES "transfer_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_session_id_fkey" FOREIGN KEY ("count_session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_counted_by_id_fkey" FOREIGN KEY ("counted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_maintenance_type_id_fkey" FOREIGN KEY ("maintenance_type_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plan_tasks" ADD CONSTRAINT "maintenance_plan_tasks_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "maintenance_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "maintenance_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_maintenance_type_id_fkey" FOREIGN KEY ("maintenance_type_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_completion_condition_id_fkey" FOREIGN KEY ("completion_condition_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_assigned_to_employee_id_fkey" FOREIGN KEY ("assigned_to_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_assigned_vendor_id_fkey" FOREIGN KEY ("assigned_vendor_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_order_tasks" ADD CONSTRAINT "maintenance_work_order_tasks_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "maintenance_work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_order_tasks" ADD CONSTRAINT "maintenance_work_order_tasks_plan_task_id_fkey" FOREIGN KEY ("plan_task_id") REFERENCES "maintenance_plan_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_work_order_tasks" ADD CONSTRAINT "maintenance_work_order_tasks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_parts" ADD CONSTRAINT "maintenance_parts_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "maintenance_work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_parts" ADD CONSTRAINT "maintenance_parts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_parts" ADD CONSTRAINT "maintenance_parts_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_parts" ADD CONSTRAINT "maintenance_parts_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_parts" ADD CONSTRAINT "maintenance_parts_stock_transaction_id_fkey" FOREIGN KEY ("stock_transaction_id") REFERENCES "stock_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "approval_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_role_id_fkey" FOREIGN KEY ("approver_role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "approval_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_current_step_id_fkey" FOREIGN KEY ("current_step_id") REFERENCES "approval_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "approval_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_delegated_for_id_fkey" FOREIGN KEY ("delegated_for_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegator_id_fkey" FOREIGN KEY ("delegator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lookup_values" ADD CONSTRAINT "lookup_values_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
