import type { Metadata } from 'next';
import { PurchaseOrderEditor } from '@/components/procurement/purchase-order-editor';

export const metadata: Metadata = {
  title: 'New purchase order',
};

export default function Page() {
  return <PurchaseOrderEditor />;
}
