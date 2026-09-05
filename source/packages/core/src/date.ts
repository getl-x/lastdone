import type { LocalDate } from "./types";

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseLocalDate(value: LocalDate): DateParts {
  const match = LOCAL_DATE_PATTERN.exec(value);

  if (!match) {
    throw new Error(`invalid local date: ${value}`);
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`invalid local date: ${value}`);
  }

  return { year, month, day };
}

export function formatLocalDate(parts: DateParts): LocalDate {
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function clampLocalDate(year: number, month: number, day: number): LocalDate {
  return formatLocalDate({
    year,
    month,
    day: Math.min(day, daysInMonth(year, month)),
  });
}

export function addCalendarDays(value: LocalDate, days: number): LocalDate {
  const parts = parseLocalDate(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);

  return formatLocalDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

export function differenceInCalendarDays(later: LocalDate, earlier: LocalDate): number {
  const laterParts = parseLocalDate(later);
  const earlierParts = parseLocalDate(earlier);
  const laterTime = Date.UTC(laterParts.year, laterParts.month - 1, laterParts.day);
  const earlierTime = Date.UTC(
    earlierParts.year,
    earlierParts.month - 1,
    earlierParts.day,
  );

  return Math.round((laterTime - earlierTime) / MILLISECONDS_PER_DAY);
}
