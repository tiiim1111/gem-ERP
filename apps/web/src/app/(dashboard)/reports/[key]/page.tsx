import type { Metadata } from 'next';
import { ReportPage } from '@/components/reports/report-page';

export const metadata: Metadata = {
  title: 'Report',
};

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <ReportPage reportKey={key} />;
}
