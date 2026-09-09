import { differenceInCalendarDays, parseLocalDate } from "./date";
import type { ItemTemporalStatus, StatusInput } from "./types";

function daysUntilDue(input: StatusInput): number | null {
  parseLocalDate(input.today);

  if (input.dueDate === null) {
    return null;
  }

  return differenceInCalendarDays(input.dueDate, input.today);
}

// Pure classification from a precomputed day delta, so callers that already
// computed `daysUntilDue` do not parse the dates a second time.
function classifyWithDays(input: StatusInput, days: number | null): ItemTemporalStatus {
  if (input.lifecycle === "paused") {
    return "paused";
  }

  if (input.lifecycle === "archived") {
    return "archived";
  }

  if (days === null) {
    return "not-started";
  }

  if (days < 0) {
    return "overdue";
  }

  if (days === 0) {
    return "due-today";
  }

  if (days <= input.dueSoonDays) {
    return "due-soon";
  }

  if (input.lastCompletedDate === null) {
    return "not-started";
  }

  return "healthy";
}

export function classifyItem(input: StatusInput): ItemTemporalStatus {
  if (input.lifecycle === "paused" || input.lifecycle === "archived") {
    return input.lifecycle;
  }

  return classifyWithDays(input, daysUntilDue(input));
}

function formatChineseStatus(status: ItemTemporalStatus, days: number | null): string {
  switch (status) {
    case "paused":
      return "已暂停";
    case "archived":
      return "已归档";
    case "overdue":
      return `已逾期 ${Math.abs(days ?? 0)} 天`;
    case "due-today":
      return "今天到期";
    case "due-soon":
    case "healthy":
      return `还有 ${days ?? 0} 天`;
    case "not-started":
      return "尚未开始";
  }
}

function formatEnglishStatus(status: ItemTemporalStatus, days: number | null): string {
  switch (status) {
    case "paused":
      return "Paused";
    case "archived":
      return "Archived";
    case "overdue": {
      const count = Math.abs(days ?? 0);
      return `${count} ${count === 1 ? "day" : "days"} overdue`;
    }
    case "due-today":
      return "Due today";
    case "due-soon":
    case "healthy": {
      const count = days ?? 0;
      return `${count} ${count === 1 ? "day" : "days"} remaining`;
    }
    case "not-started":
      return "Not started";
  }
}

export function formatRelativeStatus(input: StatusInput, locale = "en"): string {
  const days = input.dueDate === null ? null : daysUntilDue(input);
  const status = classifyWithDays(input, days);

  return locale.toLowerCase().startsWith("zh")
    ? formatChineseStatus(status, days)
    : formatEnglishStatus(status, days);
}
