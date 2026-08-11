import type { Metadata } from 'next';
import { ExportCenterPage } from '@/components/reports/export-center-page';

export const metadata: Metadata = {
  title: 'Export center',
};

export default function Page() {
  return <ExportCenterPage />;
}
