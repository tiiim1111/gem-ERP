import type { Metadata } from 'next';
import { LotsPage } from '@/components/inventory/lots-page';

export const metadata: Metadata = {
  title: 'Lots',
};

export default function Page() {
  return <LotsPage />;
}
