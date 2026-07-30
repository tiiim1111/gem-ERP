import type { Metadata } from 'next';
import { LowStockPage } from '@/components/inventory/low-stock-page';

export const metadata: Metadata = {
  title: 'Low stock',
};

export default function Page() {
  return <LowStockPage />;
}
