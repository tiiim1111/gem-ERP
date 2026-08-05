import type { Metadata } from 'next';
import { MaintenancePlanEditor } from '@/components/maintenance/plan-editor';

export const metadata: Metadata = {
  title: 'Edit maintenance plan',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MaintenancePlanEditor planId={id} />;
}
