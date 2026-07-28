import type { Metadata } from 'next';
import { ItemForm } from '@/components/items/item-form';

export const metadata: Metadata = {
  title: 'New item',
};

export default function Page() {
  return <ItemForm />;
}
