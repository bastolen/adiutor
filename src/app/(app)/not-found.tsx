/**
 * @file The 404 page inside the signed-in app, for pages that don't exist and
 * pages the user may not see (both look the same, so nothing about other
 * companies is revealed).
 */
import { SearchX } from 'lucide-react';
import Link from 'next/link';

import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';

/**
 * Explains the page isn't available, in a card in the app layout.
 *
 * @returns The 404 content.
 */
export default function AppNotFound() {
  return (
    <Card flush>
      <EmptyState
        icon={SearchX}
        title="Page not found"
        titleAs="h1"
        description="This page doesn't exist, or you don't have access to it."
        action={
          <Button asChild>
            <Link href="/dashboard">Go to your dashboard</Link>
          </Button>
        }
      />
    </Card>
  );
}
