/**
 * Timezone-aware schedule validation utilities.
 * Used by both client (handleSave) and server (API routes) to prevent scheduling posts in the past.
 */

/**
 * Get the current date and time in a specific timezone as YYYY-MM-DD and HH:mm strings.
 * Uses Intl.DateTimeFormat.formatToParts() for reliable, locale-independent results.
 */
export function getNowInTimezone(tz: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  // Intl can return "24" for midnight in some environments; normalize to "00"
  const hour = get('hour') === '24' ? '00' : get('hour');
  const time = `${hour}:${get('minute')}`;
  return { date, time };
}

/**
 * Get today's date string in a specific timezone (for HTML date input `min` attribute).
 */
export function getTodayInTimezone(tz: string): string {
  return getNowInTimezone(tz).date;
}

/**
 * Check if a scheduled date/time is in the past for a given timezone.
 * @param scheduledDate - Date string in YYYY-MM-DD format
 * @param scheduledTime - Time string in HH:mm format
 * @param timezone - IANA timezone identifier (e.g., "America/New_York")
 * @param bufferMinutes - Add this many minutes to "now" before comparing (server-side safety margin). Default 0.
 * @returns null if valid, or an error message string if in the past
 */
export function validateScheduleNotInPast(
  scheduledDate: string,
  scheduledTime: string,
  timezone: string,
  bufferMinutes = 0,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return 'Invalid date format.';
  }
  if (!/^\d{2}:\d{2}$/.test(scheduledTime)) {
    return 'Invalid time format.';
  }

  const now = getNowInTimezone(timezone);
  const scheduledStr = `${scheduledDate}T${scheduledTime}`;

  // Add buffer to current time
  const [nowH, nowM] = now.time.split(':').map(Number);
  const nowTotalMinutes = nowH * 60 + nowM + bufferMinutes;
  const bufferedH = String(Math.floor(nowTotalMinutes / 60) % 24).padStart(2, '0');
  const bufferedM = String(nowTotalMinutes % 60).padStart(2, '0');

  // Handle day overflow from buffer
  let bufferedDate = now.date;
  if (nowTotalMinutes >= 24 * 60) {
    const d = new Date(`${now.date}T12:00:00`); // noon to avoid DST edge cases
    d.setDate(d.getDate() + 1);
    bufferedDate = d.toISOString().split('T')[0];
  }

  const nowStr = `${bufferedDate}T${bufferedH}:${bufferedM}`;

  if (scheduledStr < nowStr) {
    if (bufferMinutes > 0) {
      return `Scheduled time must be at least ${bufferMinutes} minutes in the future.`;
    }
    return 'Scheduled time must be in the future.';
  }

  return null;
}
