import type { Metadata } from 'next';
import { HrisIntegrationPage } from '@/components/integrations/hris-page';

export const metadata: Metadata = {
  title: 'HRIS integration',
};

export default function Page() {
  return <HrisIntegrationPage />;
}
