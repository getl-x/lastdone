export type LocalDate = string;

export type RelativeScheduleUnit = "days" | "weeks" | "months" | "years";

export type ScheduleRule =
  | {
      type: "relative";
      every: number;
      unit: RelativeScheduleUnit;
    }
  | {
      type: "fixed-monthly";
      day: number;
    }
  | {
      type: "fixed-yearly";
      month: number;
      day: number;
    };

export type ItemLifecycle = "active" | "paused" | "archived";

export type ItemTemporalStatus =
  | "paused"
  | "archived"
  | "overdue"
  | "due-today"
  | "due-soon"
  | "healthy"
  | "not-started";

export interface StatusInput {
  today: LocalDate;
  dueDate: LocalDate | null;
  lastCompletedDate: LocalDate | null;
  dueSoonDays: number;
  lifecycle: ItemLifecycle;
}
