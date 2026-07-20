import { describe, expect, it } from "vitest";
import { clampSeconds, dateKey, elapsedSeconds, formatClock, formatDuration, HOUR } from "@/lib/time";

describe("time helpers", () => {
  it("formats durations consistently", () => {
    expect(formatDuration(2 * HOUR + 5 * 60 + 9)).toBe("2小时 5分钟 9秒");
    expect(formatDuration(30 * 60, false)).toBe("30分钟");
    expect(formatClock(2 * HOUR + 5 * 60 + 9)).toBe("02:05:09");
  });

  it("uses whole elapsed seconds and never returns a negative value", () => {
    expect(elapsedSeconds(1_000, 4_999)).toBe(3);
    expect(elapsedSeconds(5_000, 4_000)).toBe(0);
  });

  it("computes dates in the configured timezone", () => {
    const timestamp = Date.UTC(2026, 6, 18, 16, 30);
    expect(dateKey(timestamp, "Asia/Shanghai")).toBe("2026-07-19");
    expect(dateKey(timestamp, "UTC")).toBe("2026-07-18");
  });

  it("clamps configured reward values", () => {
    expect(clampSeconds(-10)).toBe(0);
    expect(clampSeconds(30 * HOUR)).toBe(24 * HOUR);
  });
});
