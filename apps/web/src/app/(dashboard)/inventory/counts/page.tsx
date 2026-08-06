import type { Metadata } from 'next';
import { CountsPage } from '@/components/counts/counts-page';

export const metadata: Metadata = {
  title: 'Count sessions',
};

export default function Page() {
  return <CountsPage />;
}
