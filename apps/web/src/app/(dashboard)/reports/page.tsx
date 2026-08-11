import type { Metadata } from 'next';
import { ReportsHubPage } from '@/components/reports/reports-hub-page';

export const metadata: Metadata = {
  title: 'Reports',
};

export default function Page() {
  return <ReportsHubPage />;
}
