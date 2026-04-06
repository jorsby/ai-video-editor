'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface DebugLog {
  id: string;
  created_at: string;
  step: string | null;
  payload: Record<string, unknown> | null;
}

type StatusFilter = 'all' | 'success' | 'error' | 'start';
type TimeRange = '1h' | '24h' | '7d' | 'all';

const TIME_RANGE_MS: Record<TimeRange, number | null> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  all: null,
};

function getStatus(payload: Record<string, unknown> | null): string {
  if (!payload) return 'unknown';
  if (typeof payload.status === 'string') return payload.status;
  if (payload.error) return 'error';
  if (payload.success === true) return 'success';
  if (payload.success === false) return 'error';
  return 'unknown';
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'success' || status === 'start'
      ? 'default'
      : status === 'error'
        ? 'destructive'
        : 'secondary';
  return <Badge variant={variant}>{status}</Badge>;
}

export default function DevLogsPage() {
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stepFilter, setStepFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    const supabase = createClient('studio');
    let query = supabase
      .from('debug_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    const ms = TIME_RANGE_MS[timeRange];
    if (ms) {
      const since = new Date(Date.now() - ms).toISOString();
      query = query.gte('created_at', since);
    }

    if (stepFilter) {
      query = query.ilike('step', `%${stepFilter}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Failed to fetch debug logs:', error);
      return;
    }
    setLogs((data as DebugLog[]) || []);
    setLoading(false);
  }, [stepFilter, timeRange]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchLogs, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchLogs]);

  const filteredLogs = logs.filter((log) => {
    if (statusFilter === 'all') return true;
    return getStatus(log.payload) === statusFilter;
  });

  // Summary stats
  const now = Date.now();
  const lastHourLogs = logs.filter(
    (l) => now - new Date(l.created_at).getTime() < 60 * 60 * 1000
  );
  const last24hErrors = logs.filter(
    (l) =>
      now - new Date(l.created_at).getTime() < 24 * 60 * 60 * 1000 &&
      getStatus(l.payload) === 'error'
  );
  const lastEvent = logs[0];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Workflow Logs</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">
            Events (last hour)
          </div>
          <div className="text-2xl font-bold">{lastHourLogs.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Errors (24h)</div>
          <div className="text-2xl font-bold text-red-500">
            {last24hErrors.length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Last event</div>
          <div className="text-sm font-mono">
            {lastEvent
              ? new Date(lastEvent.created_at).toLocaleString()
              : 'None'}
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <Input
          placeholder="Filter by step..."
          value={stepFilter}
          onChange={(e) => setStepFilter(e.target.value)}
          className="w-48"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="start">Start</option>
        </select>

        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as TimeRange)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="1h">Last hour</option>
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7 days</option>
          <option value="all">All time</option>
        </select>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded"
          />
          Auto-refresh (5s)
        </label>

        <button
          onClick={fetchLogs}
          className="h-9 rounded-md border px-3 text-sm hover:bg-muted transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Log table */}
      {loading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : filteredLogs.length === 0 ? (
        <div className="text-muted-foreground">No logs found.</div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Timestamp</th>
                <th className="text-left px-4 py-2 font-medium">Step</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">
                  Payload preview
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredLogs.map((log) => {
                const status = getStatus(log.payload);
                const isExpanded = expandedId === log.id;
                const preview = log.payload
                  ? JSON.stringify(log.payload).slice(0, 120)
                  : '';

                return (
                  <tr key={log.id} className="group">
                    <td
                      className="px-4 py-2 font-mono text-xs whitespace-nowrap cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    >
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="outline">{log.step ?? '—'}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={status} />
                    </td>
                    <td
                      className="px-4 py-2 font-mono text-xs text-muted-foreground cursor-pointer max-w-md truncate"
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    >
                      {isExpanded ? (
                        <pre className="whitespace-pre-wrap break-all text-foreground max-h-96 overflow-auto">
                          {JSON.stringify(log.payload, null, 2)}
                        </pre>
                      ) : (
                        preview
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
