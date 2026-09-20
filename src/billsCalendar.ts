import {addDaysIso} from "./scheduledPresentation";

export interface CalendarDay {
  date: string;
  dayNumber: number;
  inCurrentMonth: boolean;
}

export function monthBounds(month: string): {fromDate: string; toDate: string} {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must use YYYY-MM");
  const [year, value] = month.split("-").map(Number);
  if (value < 1 || value > 12) throw new Error("Month must use YYYY-MM");
  const toDate = new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
  return {fromDate: `${month}-01`, toDate};
}

export function calendarDays(month: string): CalendarDay[] {
  const {fromDate} = monthBounds(month);
  const firstWeekday = new Date(`${fromDate}T00:00:00Z`).getUTCDay();
  const gridStart = addDaysIso(fromDate, -firstWeekday);
  return Array.from({length: 42}, (_, index) => {
    const date = addDaysIso(gridStart, index);
    return {date, dayNumber: Number(date.slice(8, 10)), inCurrentMonth: date.startsWith(`${month}-`)};
  });
}

export function shiftMonth(month: string, offset: number): string {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const {fromDate} = monthBounds(month);
  return new Intl.DateTimeFormat("en-US", {month: "long", year: "numeric", timeZone: "UTC"}).format(new Date(`${fromDate}T00:00:00Z`));
}
