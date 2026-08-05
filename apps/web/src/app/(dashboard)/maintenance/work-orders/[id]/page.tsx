import type { Metadata } from 'next';
import { WorkOrderDetail } from '@/components/maintenance/work-order-detail';

export const metadata: Metadata = {
  title: 'Work order',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkOrderDetail workOrderId={id} />;
}
