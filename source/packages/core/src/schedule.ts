import { addCalendarDays, clampLocalDate, daysInMonth, parseLocalDate } from "./date";
import type { LocalDate, ScheduleRule } from "./types";

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function nextFixedMonthly(day: number, baseline: LocalDate): LocalDate {
  assertPositiveInteger(day, "day");

  if (day > 31) {
    throw new Error("day must not be greater than 31");
  }

  const parts = parseLocalDate(baseline);
  const currentMonthOccurrence = clampLocalDate(parts.year, parts.month, day);

  if (currentMonthOccurrence > baseline) {
    return currentMonthOccurrence;
  }

  const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;

  return clampLocalDate(nextYear, nextMonth, day);
}

function nextFixedYearly(month: number, day: number, baseline: LocalDate): LocalDate {
  assertPositiveInteger(month, "month");
  assertPositiveInteger(day, "day");

  if (month > 12) {
    throw new Error("month must not be greater than 12");
  }

  // Validate against a leap year so fixed-yearly rules may target 2/29.
  // clampLocalDate clamps it to 2/28 in non-leap years.
  if (day > 31 || day > daysInMonth(2000, month)) {
    throw new Error("day is invalid for month");
  }

  const parts = parseLocalDate(baseline);
  const currentYearOccurrence = clampLocalDate(parts.year, month, day);

  if (currentYearOccurrence > baseline) {
    return currentYearOccurrence;
  }

  return clampLocalDate(parts.year + 1, month, day);
}

function addRelativeMonths(baseline: LocalDate, monthsToAdd: number): LocalDate {
  const parts = parseLocalDate(baseline);
  const zeroBasedTargetMonth = parts.month - 1 + monthsToAdd;
  const year = parts.year + Math.floor(zeroBasedTargetMonth / 12);
  const month = (zeroBasedTargetMonth % 12) + 1;

  return clampLocalDate(year, month, parts.day);
}

export function nextDueDate(rule: ScheduleRule, baseline: LocalDate): LocalDate {
  parseLocalDate(baseline);

  if (rule.type === "fixed-monthly") {
    return nextFixedMonthly(rule.day, baseline);
  }

  if (rule.type === "fixed-yearly") {
    return nextFixedYearly(rule.month, rule.day, baseline);
  }

  assertPositiveInteger(rule.every, "every");

  switch (rule.unit) {
    case "days":
      return addCalendarDays(baseline, rule.every);
    case "weeks":
      return addCalendarDays(baseline, rule.every * 7);
    case "months":
      return addRelativeMonths(baseline, rule.every);
    case "years": {
      const parts = parseLocalDate(baseline);
      return clampLocalDate(parts.year + rule.every, parts.month, parts.day);
    }
  }
}
