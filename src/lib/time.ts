export const SECOND = 1;
export const MINUTE = 60;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function clampSeconds(value: number, minimum = 0, maximum = DAY): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export function elapsedSeconds(startedAt: number, endedAt = Date.now()): number {
  return Math.max(0, Math.floor((endedAt - startedAt) / 1000));
}

export function formatDuration(totalSeconds: number, withSeconds = true): string {
  const safe = Math.max(0, Math.floor(Math.abs(totalSeconds)));
  const hours = Math.floor(safe / HOUR);
  const minutes = Math.floor((safe % HOUR) / MINUTE);
  const seconds = safe % MINUTE;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0 || (hours > 0 && !withSeconds)) parts.push(`${minutes}分钟`);
  if (withSeconds && (seconds > 0 || parts.length === 0)) parts.push(`${seconds}秒`);
  if (!withSeconds && parts.length === 0) parts.push("0分钟");

  return parts.join(" ");
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / HOUR);
  const minutes = Math.floor((safe % HOUR) / MINUTE);
  const seconds = safe % MINUTE;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function dateKey(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatDateTime(timestamp: number, timezone = "Asia/Shanghai"): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
