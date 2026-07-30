import type { Metadata } from 'next';
import { TransactionsPage } from '@/components/inventory/transactions-page';

export const metadata: Metadata = {
  title: 'Stock transactions',
};

export default function Page() {
  return <TransactionsPage />;
}
