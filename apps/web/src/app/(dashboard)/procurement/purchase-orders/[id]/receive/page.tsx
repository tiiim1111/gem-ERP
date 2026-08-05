import type { Metadata } from 'next';
import { ReceivePage } from '@/components/procurement/receive-page';

export const metadata: Metadata = {
  title: 'Receive goods',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceivePage poId={id} />;
}
