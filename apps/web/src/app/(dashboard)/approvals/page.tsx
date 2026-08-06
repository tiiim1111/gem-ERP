import type { Metadata } from 'next';
import { ApprovalsPage } from '@/components/approvals/approvals-page';

export const metadata: Metadata = {
  title: 'Approvals',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request } = await searchParams;
  return <ApprovalsPage initialRequestId={request} />;
}
