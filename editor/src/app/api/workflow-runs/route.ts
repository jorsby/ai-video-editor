import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient('social_auth');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const monthParam = searchParams.get('month'); // YYYY-MM

    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json(
        { error: 'month param required (YYYY-MM)' },
        { status: 400 }
      );
    }

    const [year, month] = monthParam.split('-');
    const monthStart = `${year}-${month}-01`;
    const nextMonth = new Date(Number(year), Number(month), 1); // month is 1-based → next month
    const nextYear = nextMonth.getFullYear();
    const nextMonthStr = String(nextMonth.getMonth() + 1).padStart(2, '0');
    const monthEnd = `${nextYear}-${nextMonthStr}-01`;

    const { data, error } = await supabase
      .from('workflow_runs')
      .select(`
        *,
        lanes:workflow_run_lanes (*)
      `)
      .eq('user_id', user.id)
      .or(
        `and(schedule_type.eq.scheduled,base_date.gte.${monthStart},base_date.lt.${monthEnd}),` +
          `and(schedule_type.eq.now,created_at.gte.${monthStart},created_at.lt.${monthEnd})`
      )
      .order('created_at', { ascending: false });

    if (error) {
      console.error('workflow-runs fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch workflow runs' },
        { status: 500 }
      );
    }

    return NextResponse.json({ runs: data ?? [] });
  } catch (error) {
    console.error('workflow-runs route error:', error);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}
