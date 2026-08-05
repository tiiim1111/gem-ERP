import type { Metadata } from 'next';
import { PurchaseOrdersPage } from '@/components/procurement/purchase-orders-page';

export const metadata: Metadata = {
  title: 'Purchase orders',
};

export default function Page() {
  return <PurchaseOrdersPage />;
}
