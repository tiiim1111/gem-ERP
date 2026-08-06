import { redirect } from 'next/navigation';

/**
 * Canonical deep-link target for count sessions (@gemerp/shared
 * NOTIFICATION_LINKS.countSession → /counts/:id). The page itself lives under
 * Inventory.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/inventory/counts/${id}`);
}
