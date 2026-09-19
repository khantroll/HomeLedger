import { describe,expect,it } from "vitest";
import { classifyDuplicates } from "./duplicateDetection";
import type { Transaction } from "./domain";

const existing:Transaction[]=[{id:"existing",accountId:"checking",postedDate:"2026-09-10",payee:"Neighborhood Market #123",category:"Food",amountMinor:-4299,status:"cleared"}];

describe("tiered duplicate detection",()=>{
  it("classifies deterministic confidence levels",()=>{
    const rows=classifyDuplicates([
      {sourceRow:1,postedDate:"2026-09-10",payee:"Neighborhood Market #123",amountMinor:-4299},
      {sourceRow:2,postedDate:"2026-09-10",payee:"Different description",amountMinor:-4299},
      {sourceRow:3,postedDate:"2026-09-13",payee:"Unrelated",amountMinor:-4299},
      {sourceRow:4,postedDate:"2026-09-20",payee:"Neighborhood Market",amountMinor:-4299}
    ],existing);
    expect(rows.map(row=>row.duplicate?.confidence)).toEqual(["exact","probable","possible",undefined]);
  });

  it("treats repeated provider IDs as exact matches",()=>{
    const rows=classifyDuplicates([{sourceRow:1,postedDate:"2026-09-20",payee:"Renamed",amountMinor:-1,externalId:"bank-1"}],[{...existing[0],externalId:"bank-1"}]);
    expect(rows[0].duplicate).toMatchObject({confidence:"exact",existingTransactionId:"existing"});
  });
});
