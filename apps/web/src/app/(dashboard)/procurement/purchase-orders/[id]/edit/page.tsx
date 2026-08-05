import type { Metadata } from 'next';
import { PurchaseOrderEditor } from '@/components/procurement/purchase-order-editor';

export const metadata: Metadata = {
  title: 'Edit purchase order',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseOrderEditor poId={id} />;
}
