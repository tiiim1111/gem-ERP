import type { Metadata } from 'next';
import { WorkflowEditor } from '@/components/approvals/workflow-editor';

export const metadata: Metadata = {
  title: 'New approval workflow',
};

export default function Page() {
  return <WorkflowEditor />;
}
