import type { Metadata } from 'next';
import { AssetsPage } from '@/components/assets/assets-page';

export const metadata: Metadata = {
  title: 'Assets',
};

export default function Page() {
  return <AssetsPage />;
}
