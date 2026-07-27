import type { Metadata } from 'next';
import { BranchesPage } from '@/components/branches/branches-page';

export const metadata: Metadata = {
  title: 'Branches',
};

export default function Page() {
  return <BranchesPage />;
}
