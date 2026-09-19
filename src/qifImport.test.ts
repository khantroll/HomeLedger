import { describe, expect, it } from "vitest";
import { buildQifPreview, parseQif } from "./qifImport";

describe("QIF statement parser", () => {
  it("parses bank transactions, metadata, categories, references, and transfers", () => {
    const statement = parseQif(`!Account\nNHousehold Checking\nTBank\n^\n!Type:Bank\nD9/18'26\nT-12.34\nPNeighborhood Market\nMWeekly groceries\nN1042\nLFood:Groceries\n^\nD9/19/2026\nU-100.00\nPTransfer\nL[Savings]\n^`);
    expect(statement).toMatchObject({ accountName: "Household Checking", accountType: "bank" });
    expect(statement.rows[0]).toMatchObject({ postedDate: "2026-09-18", amountMinor: -1234, category: "Food:Groceries", memo: "Weekly groceries · Reference: 1042" });
    expect(statement.rows[1].category).toBe("Transfer: Savings");
  });

  it("parses cash and credit-card types", () => {
    expect(parseQif("!Type:Cash\nD1/2/26\nT5.00\nPCash\n^").accountType).toBe("cash");
    expect(parseQif("!Type:CCard\nD1/2/26\nT-5.00\nPCard\n^").accountType).toBe("credit-card");
  });

  it("preserves true split transactions", () => {
    const row = parseQif("!Type:Bank\nD9/18/2026\nT-30.00\nPStore\nSFood\nEGroceries\n$-20.00\nSHousehold\n$-10.00\n^").rows[0];
    expect(row).toMatchObject({ category: "Split transaction", splits: [{ category: "Food", amountMinor: -2000, memo: "Groceries" }, { category: "Household", amountMinor: -1000 }] });
  });

  it("rejects malformed splits and investment QIF", () => {
    expect(() => parseQif("!Type:Bank\nD9/18/2026\nT-30.00\nPStore\nSFood\n$-20.00\n^")).toThrow(/split total/);
    expect(() => parseQif("!Type:Invst\nD9/18/2026\nT1.00\n^")).toThrow(/Investment-account/);
  });

  it("rejects multi-account files rather than merging accounts", () => {
    expect(() => parseQif("!Type:Bank\nD1/2/26\nT1.00\nPOne\n^\n!Type:Bank\nD1/3/26\nT2.00\nPTwo\n^")).toThrow(/one account at a time/);
  });

  it("marks duplicate transactions during preview", () => {
    const statement = parseQif("!Type:Bank\nD9/18/2026\nT-1.00\nPStore\n^\nD9/18/2026\nT-1.00\nPStore\n^");
    const preview = buildQifPreview(statement, []);
    expect(preview[0].duplicate).toBeUndefined();
    expect(preview[1].duplicate).toMatchObject({confidence:"exact"});
  });
});
