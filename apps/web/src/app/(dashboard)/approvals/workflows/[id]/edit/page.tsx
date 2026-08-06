import type { Metadata } from 'next';
import { WorkflowEditor } from '@/components/approvals/workflow-editor';

export const metadata: Metadata = {
  title: 'Edit approval workflow',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkflowEditor workflowId={id} />;
}
