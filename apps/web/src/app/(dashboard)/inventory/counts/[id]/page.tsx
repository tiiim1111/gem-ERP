import type { Metadata } from 'next';
import { CountDetail } from '@/components/counts/count-detail';

export const metadata: Metadata = {
  title: 'Count session',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CountDetail countId={id} />;
}
