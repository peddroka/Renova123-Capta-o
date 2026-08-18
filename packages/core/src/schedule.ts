import type { OutreachSettings } from "@renova123/shared";

export function randomIntervalMs(minSeconds: number, maxSeconds: number, random = Math.random): number {
  const min = Math.max(5, Math.min(minSeconds, maxSeconds));
  const max = Math.max(min, maxSeconds);
  return Math.round((min + random() * (max - min)) * 1000);
}

export function canStartOutreach(now: Date, settings: OutreachSettings): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[parts.find((part) => part.type === "weekday")?.value ?? ""];
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const second = parts.find((part) => part.type === "second")?.value ?? "00";
  const time = Number(hour) * 3600 + Number(minute) * 60 + Number(second);
  const [startHour, startMinute] = settings.startTime.split(":").map(Number);
  const [endHour, endMinute] = settings.endTime.split(":").map(Number);
  const start = (startHour ?? 0) * 3600 + (startMinute ?? 0) * 60;
  const end = (endHour ?? 0) * 3600 + (endMinute ?? 0) * 60;
  return weekday !== undefined && settings.weekdays.includes(weekday) && time >= start && time < end;
}
