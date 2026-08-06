import { redirect } from 'next/navigation';

/**
 * Canonical deep-link target for approval requests (@gemerp/shared
 * NOTIFICATION_LINKS.approvalRequest → /approvals/:id). The inbox renders the
 * detail as a sheet, so this route forwards into it.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/approvals?request=${id}`);
}
