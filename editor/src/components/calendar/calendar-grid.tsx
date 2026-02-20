'use client';

import { useMemo } from 'react';
import { CalendarDayCell } from './calendar-day-cell';
import type { MixpostPost } from '@/types/calendar';

interface CalendarGridProps {
  currentMonth: Date;
  postsByDate: Map<string, MixpostPost[]>;
  onPostClick: (post: MixpostPost) => void;
}

interface DayCellData {
  date: Date;
  dateKey: string;
  isCurrentMonth: boolean;
  isToday: boolean;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarGrid({
  currentMonth,
  postsByDate,
  onPostClick,
}: CalendarGridProps) {
  const days = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = startWeekday + daysInMonth > 35 ? 42 : 35;

    const todayKey = formatDateKey(new Date());

    const cells: DayCellData[] = [];
    for (let i = 0; i < totalCells; i++) {
      const dayOffset = i - startWeekday;
      const date = new Date(year, month, dayOffset + 1);
      const dateKey = formatDateKey(date);
      cells.push({
        date,
        dateKey,
        isCurrentMonth: date.getMonth() === month,
        isToday: dateKey === todayKey,
      });
    }
    return cells;
  }, [currentMonth]);

  return (
    <div>
      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <CalendarDayCell
            key={day.dateKey}
            date={day.date}
            isCurrentMonth={day.isCurrentMonth}
            isToday={day.isToday}
            posts={postsByDate.get(day.dateKey) || []}
            onPostClick={onPostClick}
          />
        ))}
      </div>
    </div>
  );
}
