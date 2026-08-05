import type { Metadata } from 'next';
import { MaintenancePlanEditor } from '@/components/maintenance/plan-editor';

export const metadata: Metadata = {
  title: 'New maintenance plan',
};

export default function Page() {
  return <MaintenancePlanEditor />;
}
