import type { Metadata } from 'next';
import { WorkOrdersPage } from '@/components/maintenance/work-orders-page';

export const metadata: Metadata = {
  title: 'Work orders',
};

export default function Page() {
  return <WorkOrdersPage />;
}
