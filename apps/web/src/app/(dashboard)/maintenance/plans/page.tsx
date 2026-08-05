import type { Metadata } from 'next';
import { MaintenancePlansPage } from '@/components/maintenance/plans-page';

export const metadata: Metadata = {
  title: 'Maintenance plans',
};

export default function Page() {
  return <MaintenancePlansPage />;
}
