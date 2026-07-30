import type { Metadata } from 'next';
import { TransactionCreateWizard } from '@/components/inventory/transaction-create';

export const metadata: Metadata = {
  title: 'New stock transaction',
};

export default function Page() {
  return <TransactionCreateWizard />;
}
