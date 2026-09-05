import { describe, expect, it } from "vitest";

import statusCases from "../../contracts/statuses.json";
import { classifyItem, formatRelativeStatus, type StatusInput } from "./index";

describe("item temporal status", () => {
  for (const testCase of statusCases) {
    it(testCase.name, () => {
      const input = testCase.input as StatusInput;

      expect(classifyItem(input)).toBe(testCase.expected);
      expect(formatRelativeStatus(input, "zh-CN")).toBe(testCase.expectedZh);
    });
  }
});
