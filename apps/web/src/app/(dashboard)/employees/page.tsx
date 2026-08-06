import type { Metadata } from 'next';
import { EmployeesPage } from '@/components/employees/employees-page';

export const metadata: Metadata = {
  title: 'Employees',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ detail?: string }>;
}) {
  const { detail } = await searchParams;
  return <EmployeesPage initialDetailId={detail} />;
}
