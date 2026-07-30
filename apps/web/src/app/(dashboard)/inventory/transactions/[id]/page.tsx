import type { Metadata } from 'next';
import { TransactionDetail } from '@/components/inventory/transaction-detail';

export const metadata: Metadata = {
  title: 'Stock transaction',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TransactionDetail transactionId={id} />;
}
