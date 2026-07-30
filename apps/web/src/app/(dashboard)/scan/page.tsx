import type { Metadata } from 'next';
import { ScanPage } from '@/components/scan/scan-page';

export const metadata: Metadata = {
  title: 'Scan',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return <ScanPage initialCode={code} />;
}
