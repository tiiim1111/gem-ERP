import type { Metadata } from 'next';
import { MaintenancePlanDetail } from '@/components/maintenance/plan-detail';

export const metadata: Metadata = {
  title: 'Maintenance plan',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MaintenancePlanDetail planId={id} />;
}
