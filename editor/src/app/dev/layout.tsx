import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default async function DevLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-6 py-3 flex items-center gap-4">
        <Link
          href="/editor"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Back to editor
        </Link>
        <span className="text-sm font-medium">Dev Tools</span>
        <nav className="ml-auto flex items-center gap-3">
          <Link
            href="/dev/logs"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Logs
          </Link>
          <Link
            href="/dev/schema-inspector"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Schema Inspector
          </Link>
          <Link
            href="/dev/api"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            API Reference
          </Link>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
