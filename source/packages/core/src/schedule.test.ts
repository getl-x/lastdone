import { describe, expect, it } from "vitest";

import scheduleCases from "../../contracts/schedules.json";
import { nextDueDate, type ScheduleRule } from "./index";

describe("nextDueDate", () => {
  for (const testCase of scheduleCases) {
    it(testCase.name, () => {
      expect(nextDueDate(testCase.rule as ScheduleRule, testCase.baseline)).toBe(
        testCase.expected,
      );
    });
  }

  it("clamps a fixed-yearly February 29 to February 28 in non-leap years", () => {
    const rule: ScheduleRule = { type: "fixed-yearly", month: 2, day: 29 };

    expect(nextDueDate(rule, "2024-02-28")).toBe("2024-02-29");
    expect(nextDueDate(rule, "2024-02-29")).toBe("2025-02-28");
  });

  it("rejects a non-positive relative interval", () => {
    expect(() =>
      nextDueDate({ type: "relative", every: 0, unit: "days" }, "2026-09-05"),
    ).toThrow("every must be a positive integer");
  });

  it("rejects an invalid ISO local date", () => {
    expect(() =>
      nextDueDate({ type: "relative", every: 1, unit: "days" }, "2026-02-30"),
    ).toThrow("invalid local date");
  });
});
