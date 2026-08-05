import type { Metadata } from 'next';
import { GoodsReceiptDetail } from '@/components/procurement/goods-receipt-detail';

export const metadata: Metadata = {
  title: 'Goods receipt',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GoodsReceiptDetail receiptId={id} />;
}
