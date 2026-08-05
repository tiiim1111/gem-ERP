import type { Metadata } from 'next';
import { PurchaseHistoryPage } from '@/components/procurement/purchase-history-page';

export const metadata: Metadata = {
  title: 'Purchase history',
};

export default function Page() {
  return <PurchaseHistoryPage />;
}
