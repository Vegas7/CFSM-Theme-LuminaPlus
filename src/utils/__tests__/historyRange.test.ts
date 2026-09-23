import { describe, expect, it } from "vitest";
import {
  historyChartRangeSeconds,
  inferHistoryIntervalSeconds,
} from "@/utils/historyRange";

describe("history range metadata", () => {
  it("converts the requested API range into a fixed chart range", () => {
    expect(
      historyChartRangeSeconds({ rangeStartMs: 1_000_000, rangeEndMs: 4_600_000 }),
    ).toEqual([1_000, 4_600]);
    expect(
      historyChartRangeSeconds({ rangeStartMs: 4_600_000, rangeEndMs: 1_000_000 }),
    ).toBeNull();
  });

  it("infers the legacy sampling interval from record timestamps", () => {
    const end = Date.UTC(2026, 6, 13);
    const records = Array.from({ length: 12 }, (_, index) => ({
      time: end - (11 - index) * 5 * 60_000,
    }));
    expect(inferHistoryIntervalSeconds(records)).toBe(5 * 60);
  });
});
