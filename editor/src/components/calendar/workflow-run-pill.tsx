'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { WorkflowRun, WorkflowRunLane } from '@/types/workflow-run';

// Maps language codes to display labels
const LANG_LABEL: Record<string, string> = {
  en: 'EN', tr: 'TR', ar: 'AR', es: 'ES',
  fr: 'FR', de: 'DE', it: 'IT', pt: 'PT',
};

function getRunStatusColor(lanes: WorkflowRunLane[]): 'green' | 'yellow' | 'red' {
  const statuses = lanes.map(l => l.status);
  if (statuses.some(s => s === 'failed')) return 'red';
  if (statuses.every(s => s === 'published')) return 'green';
  return 'yellow';
}

interface WorkflowRunPillProps {
  run: WorkflowRun;
  onClick: (run: WorkflowRun) => void;
}

export const WorkflowRunPill = React.memo(function WorkflowRunPill({ run, onClick }: WorkflowRunPillProps) {
  const color = getRunStatusColor(run.lanes);

  const colorClass = {
    green: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    yellow: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    red: 'bg-red-500/20 text-red-400 border-red-500/30',
  }[color];

  const statusDot = {
    green: 'bg-emerald-400',
    yellow: 'bg-blue-400',
    red: 'bg-red-400',
  }[color];

  const langLabels = run.lanes
    .map(l => LANG_LABEL[l.language] ?? l.language.toUpperCase())
    .join(' · ');

  const timeLabel = run.schedule_type === 'scheduled' && run.base_time
    ? formatTime(run.base_time)
    : run.schedule_type === 'now'
      ? 'posted'
      : null;

  return (
    <button
      type="button"
      onClick={() => onClick(run)}
      className={cn(
        'flex w-full cursor-pointer items-center gap-1.5 rounded border px-1.5 py-1 text-left transition-opacity hover:opacity-80',
        colorClass
      )}
      title={`Workflow run · ${langLabels}`}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] leading-tight font-medium">{langLabels}</p>
        {timeLabel && (
          <p className="text-[9px] leading-none opacity-70">{timeLabel}</p>
        )}
      </div>
    </button>
  );
});

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}
