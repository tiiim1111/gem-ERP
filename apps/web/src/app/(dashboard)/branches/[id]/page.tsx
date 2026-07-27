import type { Metadata } from 'next';
import { BranchDetail } from '@/components/branches/branch-detail';

export const metadata: Metadata = {
  title: 'Branch',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BranchDetail branchId={id} />;
}
