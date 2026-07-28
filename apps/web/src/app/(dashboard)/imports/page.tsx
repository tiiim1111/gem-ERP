import type { Metadata } from 'next';
import { ImportsPage } from '@/components/imports/imports-page';

export const metadata: Metadata = {
  title: 'Imports',
};

export default function Page() {
  return <ImportsPage />;
}
