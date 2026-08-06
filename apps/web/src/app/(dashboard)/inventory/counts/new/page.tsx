import type { Metadata } from 'next';
import { CountCreate } from '@/components/counts/count-create';

export const metadata: Metadata = {
  title: 'New count session',
};

export default function Page() {
  return <CountCreate />;
}
