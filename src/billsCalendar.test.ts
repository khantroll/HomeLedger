import {describe, expect, it} from "vitest";
import {calendarDays, monthBounds, monthLabel, shiftMonth} from "./billsCalendar";

describe("bills calendar", () => {
  it("builds a stable six-week UTC month grid", () => {
    const days = calendarDays("2026-09");
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual({date: "2026-08-30", dayNumber: 30, inCurrentMonth: false});
    expect(days[2]).toEqual({date: "2026-09-01", dayNumber: 1, inCurrentMonth: true});
    expect(days[41].date).toBe("2026-10-10");
  });

  it("handles leap months and year boundaries", () => {
    expect(monthBounds("2028-02")).toEqual({fromDate: "2028-02-01", toDate: "2028-02-29"});
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthLabel("2026-09")).toBe("September 2026");
  });
});
