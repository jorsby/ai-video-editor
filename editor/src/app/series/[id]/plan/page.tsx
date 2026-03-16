import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { SeriesPlanningView } from '@/components/series/series-planning-view';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SeriesPlanPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient('studio');

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Load series with onboarding data
  const { data: series, error } = await supabase
    .from('series')
    .select(
      'id, name, genre, tone, bible, plan_draft, onboarding_messages, plan_status'
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !series) {
    redirect('/series');
  }

  // If already finalized, go to detail view
  if (series.plan_status === 'finalized') {
    redirect('/series');
  }

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-4">
          <Link href="/series">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
              <span className="ml-1.5">Series</span>
            </Button>
          </Link>
          <div>
            <span className="text-lg font-semibold tracking-tight">
              {series.name}
            </span>
            <span className="ml-2 text-sm text-muted-foreground">
              — Planning
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <SeriesPlanningView
          seriesId={series.id}
          seriesName={series.name}
          seriesGenre={series.genre}
          seriesTone={series.tone}
          initialMessages={
            Array.isArray(series.onboarding_messages)
              ? series.onboarding_messages
              : []
          }
          initialPlan={series.plan_draft ?? null}
        />
      </main>
    </div>
  );
}
