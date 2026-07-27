import type { Metadata } from 'next';
import { UsersPage } from '@/components/users/users-page';

export const metadata: Metadata = {
  title: 'Users',
};

export default function Page() {
  return <UsersPage />;
}
