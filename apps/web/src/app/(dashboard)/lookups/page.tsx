import type { Metadata } from 'next';
import { LookupsPage } from '@/components/lookups/lookups-page';

export const metadata: Metadata = {
  title: 'Lookups',
};

export default function Page() {
  return <LookupsPage />;
}
