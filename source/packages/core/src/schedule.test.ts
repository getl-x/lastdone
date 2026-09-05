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
