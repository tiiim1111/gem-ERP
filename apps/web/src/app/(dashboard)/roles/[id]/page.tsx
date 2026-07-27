import type { Metadata } from 'next';
import { RoleDetail } from '@/components/roles/role-detail';

export const metadata: Metadata = {
  title: 'Role',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RoleDetail roleId={id} />;
}
