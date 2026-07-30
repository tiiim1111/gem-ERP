import type { Metadata } from 'next';
import { TransfersPage } from '@/components/transfers/transfers-page';

export const metadata: Metadata = {
  title: 'Transfers',
};

export default function Page() {
  return <TransfersPage />;
}
