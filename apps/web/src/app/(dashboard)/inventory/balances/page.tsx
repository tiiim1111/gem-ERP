import type { Metadata } from 'next';
import { BalancesPage } from '@/components/inventory/balances-page';

export const metadata: Metadata = {
  title: 'Stock balances',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string; itemId?: string }>;
}) {
  const { locationId, itemId } = await searchParams;
  return <BalancesPage initialLocationId={locationId} initialItemId={itemId} />;
}
