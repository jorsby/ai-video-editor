'use client';

import { Input } from '@/components/ui/input';

interface SchedulePickerProps {
  scheduleType: 'now' | 'scheduled';
  onScheduleTypeChange: (type: 'now' | 'scheduled') => void;
  scheduledDate: string;
  onScheduledDateChange: (date: string) => void;
  scheduledTime: string;
  onScheduledTimeChange: (time: string) => void;
  timezone: string;
  onTimezoneChange: (tz: string) => void;
}

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function SchedulePicker({
  scheduleType,
  onScheduleTypeChange,
  scheduledDate,
  onScheduledDateChange,
  scheduledTime,
  onScheduledTimeChange,
  timezone,
  onTimezoneChange,
}: SchedulePickerProps) {
  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-zinc-400">When to Post</label>

      {/* Mode selector */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onScheduleTypeChange('now')}
          className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
            scheduleType === 'now'
              ? 'border-white bg-white text-black'
              : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
          }`}
        >
          Post Now
        </button>
        <button
          type="button"
          onClick={() => onScheduleTypeChange('scheduled')}
          className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
            scheduleType === 'scheduled'
              ? 'border-white bg-white text-black'
              : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
          }`}
        >
          Schedule
        </button>
      </div>

      {/* Schedule inputs */}
      {scheduleType === 'scheduled' && (
        <div className="space-y-3 rounded-lg border border-white/[0.08] bg-zinc-900/40 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] text-muted-foreground">
                Date
              </label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => onScheduledDateChange(e.target.value)}
                className="bg-zinc-900/60 border-white/[0.08] text-sm"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] text-muted-foreground">
                Time
              </label>
              <Input
                type="time"
                value={scheduledTime}
                onChange={(e) => onScheduledTimeChange(e.target.value)}
                className="bg-zinc-900/60 border-white/[0.08] text-sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] text-muted-foreground">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => onTimezoneChange(e.target.value)}
              className="h-9 w-full rounded-md border border-white/[0.08] bg-zinc-900/60 px-3 text-sm text-foreground outline-none focus:border-ring"
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
