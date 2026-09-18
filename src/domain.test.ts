import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney, runningBalances, sumMoney, validateSplits, type Transaction } from "./domain";

describe("money domain", () => {
  it("formats integer minor units", () => expect(formatMoney(-123456)).toBe("-$1,234.56"));
  it("adds integer minor units exactly", () => expect(sumMoney([10, 20, -3])).toBe(27));
  it("parses currency text without floating point", () => {
    expect(parseMoney("1,234.56")).toBe(123456);
    expect(parseMoney("-0.09")).toBe(-9);
    expect(parseMoney("$12.5")).toBe(1250);
  });
  it("rejects amounts with fractional cents", () => expect(() => parseMoney("1.999")).toThrow());
  it("rejects non-integer money", () => expect(() => sumMoney([10.5])).toThrow());
  it("validates split totals", () => expect(validateSplits({ amountMinor: -1000, splits: [
    { id: "1", category: "food", amountMinor: -700 },
    { id: "2", category: "household", amountMinor: -300 }
  ] })).toBe(true));
  it("computes running balances", () => {
    const base = { accountId: "a", postedDate: "2026-01-01", payee: "p", category: "c", status: "cleared" as const };
    const rows: Transaction[] = [
      { ...base, id: "1", amountMinor: 100 },
      { ...base, id: "2", amountMinor: -40 }
    ];
    expect(runningBalances(1000, rows)).toEqual([1100, 1060]);
  });
});
