import type { Metadata } from 'next';
import { LedgerPage } from '@/components/inventory/ledger-page';

export const metadata: Metadata = {
  title: 'Stock ledger',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ itemId?: string; warehouseId?: string }>;
}) {
  const { itemId, warehouseId } = await searchParams;
  return <LedgerPage initialItemId={itemId} initialWarehouseId={warehouseId} />;
}
