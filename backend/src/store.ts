import { DateTime } from "luxon";
import type { AvailabilityException, Booking, EventType, Owner } from "./types.js";

export const TIMEZONE = "Europe/Moscow";
export const WORK_START = 9;
export const WORK_END = 18;
export const BOOKING_WINDOW_DAYS = 14;

export class CalendarStore {
  readonly owner: Owner = {
    id: "owner-1",
    fullName: "Анна Петрова",
    email: "anna@example.com",
    timezone: TIMEZONE,
  };
  readonly eventTypes: EventType[] = [];
  readonly bookings: Booking[] = [];
  readonly exceptions: AvailabilityException[] = [];

  constructor() {
    this.addEventType({ title: "Короткая встреча", description: "Быстрый созвон по одному вопросу.", durationMinutes: 30 });
    this.addEventType({ title: "Подробная консультация", description: "Время для обстоятельного разговора.", durationMinutes: 60 });
  }

  addEventType(input: { title: string; description?: string; durationMinutes: number }): EventType {
    const now = new Date().toISOString();
    const event: EventType = { id: crypto.randomUUID(), ...input, isActive: true, createdAt: now, updatedAt: now };
    this.eventTypes.push(event);
    return event;
  }
}

export function nowInOwnerZone(): DateTime {
  return DateTime.now().setZone(TIMEZONE);
}

export function isSlotBoundary(value: DateTime, durationMinutes: number): boolean {
  const minuteOfDay = value.hour * 60 + value.minute;
  return (
    value.weekday <= 5 &&
    minuteOfDay >= WORK_START * 60 &&
    minuteOfDay + durationMinutes <= WORK_END * 60 &&
    (minuteOfDay - WORK_START * 60) % durationMinutes === 0
  );
}

export function parseInstant(value: unknown): DateTime | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = DateTime.fromISO(value, { setZone: true });
  return parsed.isValid && value.includes("T") ? parsed : null;
}

export function parseDate(value: unknown): DateTime | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = DateTime.fromISO(value, { zone: TIMEZONE });
  return parsed.isValid ? parsed.startOf("day") : null;
}

export function overlaps(aStart: DateTime, aEnd: DateTime, bStart: DateTime, bEnd: DateTime): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function windowBounds() {
  const from = nowInOwnerZone().startOf("day");
  return { from, to: from.plus({ days: BOOKING_WINDOW_DAYS - 1 }).endOf("day") };
}

export function withinBookingWindow(start: DateTime, end: DateTime): boolean {
  const bounds = windowBounds();
  return start >= bounds.from && end <= bounds.to;
}

export function dateRangeWithinWindow(from: DateTime, to: DateTime): boolean {
  const bounds = windowBounds();
  return from >= bounds.from.startOf("day") && to <= bounds.to.startOf("day");
}

export function iso(value: DateTime): string {
  return value.toUTC().toISO({ suppressMilliseconds: true })!;
}
