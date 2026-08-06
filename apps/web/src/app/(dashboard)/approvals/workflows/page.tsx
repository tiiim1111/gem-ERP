import type { Metadata } from 'next';
import { WorkflowsPage } from '@/components/approvals/workflows-page';

export const metadata: Metadata = {
  title: 'Approval workflows',
};

export default function Page() {
  return <WorkflowsPage />;
}
