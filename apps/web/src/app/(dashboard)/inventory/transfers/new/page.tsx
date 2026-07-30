import type { Metadata } from 'next';
import { TransferCreate } from '@/components/transfers/transfer-create';

export const metadata: Metadata = {
  title: 'New transfer',
};

export default function Page() {
  return <TransferCreate />;
}
