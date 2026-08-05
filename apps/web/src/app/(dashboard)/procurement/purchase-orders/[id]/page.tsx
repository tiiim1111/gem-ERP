import type { Metadata } from 'next';
import { PurchaseOrderDetail } from '@/components/procurement/purchase-order-detail';

export const metadata: Metadata = {
  title: 'Purchase order',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseOrderDetail poId={id} />;
}
