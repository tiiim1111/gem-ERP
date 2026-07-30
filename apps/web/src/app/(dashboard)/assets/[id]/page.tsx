import type { Metadata } from 'next';
import { AssetDetail } from '@/components/assets/asset-detail';

export const metadata: Metadata = {
  title: 'Asset',
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const [{ id }, { action }] = await Promise.all([params, searchParams]);
  return <AssetDetail assetId={id} initialAction={action} />;
}
