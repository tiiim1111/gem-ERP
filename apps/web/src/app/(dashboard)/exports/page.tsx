import { redirect } from 'next/navigation';

/**
 * Canonical deep-link target for finished exports (@gemerp/shared
 * NOTIFICATION_LINKS.exports → /exports). The Export center itself lives
 * under Reports.
 */
export default function Page() {
  redirect('/reports/exports');
}
