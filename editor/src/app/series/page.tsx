import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { LogOut, ArrowLeft } from 'lucide-react';
import { SeriesContent } from '@/components/series/series-content';
import Link from 'next/link';

export default async function SeriesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen w-full flex flex-col bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-muted/10" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/3 rounded-full blur-3xl" />

      <header className="relative z-10 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border/50">
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="h-10 px-2 sm:px-3">
              <ArrowLeft className="w-4 h-4" />
              <span className="ml-1.5 hidden sm:inline">Dashboard</span>
            </Button>
          </Link>
          <span className="text-lg font-semibold tracking-tight">Series</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {user.email}
          </span>
          <form action="/auth/signout" method="post">
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-10 p-0 sm:w-auto sm:px-3"
              type="submit"
            >
              <LogOut className="w-4 h-4" />
              <span className="sr-only">Sign out</span>
            </Button>
          </form>
        </div>
      </header>

      <main className="relative z-10 flex-1 px-4 sm:px-6 py-6 sm:py-8">
        <SeriesContent />
      </main>
    </div>
  );
}
