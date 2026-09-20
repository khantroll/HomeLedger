import {describe,expect,it,vi} from "vitest";
import {buildRegisterCsv,buildReportCsv,exportFileName,loadAllRegisterTransactions} from "./csvExport";
import type {Account,Transaction,TransactionPage} from "./domain";
import type {TransactionReport} from "./reportMath";

const accounts:Account[]=[{id:"a",name:"Checking",type:"checking",currency:"USD",balanceMinor:0,ownerLabel:"Household"},{id:"b",name:"Savings",type:"savings",currency:"USD",balanceMinor:0,ownerLabel:"Household"}];
const transaction:Transaction={id:"t1",accountId:"a",postedDate:"2026-09-01",payee:"=HYPERLINK(\"bad\")",originalPayee:"BANK, INC",category:"Split transaction",amountMinor:-1234,status:"review",memo:"line one\nline two",source:"import",externalId:"external",importBatchId:"batch",transferAccountId:"b",splits:[{id:"s",category:"Food",amountMinor:-1234,memo:"weekly"}]};

describe("CSV exports",()=>{
  it("writes exact decimal values, provenance, splits, and neutralized spreadsheet formulas",()=>{
    const csv=buildRegisterCsv([transaction],accounts);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("-12.34");
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"BANK, INC"');
    expect(csv).toContain('"Food: -12.34 (weekly)"');
    expect(csv).toContain('"Savings"');
  });

  it("loads every stable matching page rather than exporting only the visible register page",async()=>{
    const first=Array.from({length:500},(_,index)=>({...transaction,id:`t${index}`}));
    const second=[{...transaction,id:"last"}];
    const listTransactionsPage=vi.fn(async query=>({transactions:query.offset===0?first:second,totalCount:501,offset:query.offset??0,limit:500,priorBalanceMinor:0} satisfies TransactionPage));
    const rows=await loadAllRegisterTransactions({listTransactionsPage},{accountId:"a",status:"review"});
    expect(rows).toHaveLength(501);
    expect(listTransactionsPage).toHaveBeenNthCalledWith(2,expect.objectContaining({offset:500,limit:500,newest:false,status:"review"}));
  });

  it("rejects a register that changes while its pages are being exported",async()=>{
    const page=[{...transaction,id:"same"}];
    const listTransactionsPage=vi.fn(async query=>({transactions:page,totalCount:2,offset:query.offset??0,limit:500,priorBalanceMinor:0} satisfies TransactionPage));
    await expect(loadAllRegisterTransactions({listTransactionsPage},{})).rejects.toThrow("changed during export");
  });

  it("exports report summary, trends, and both spending groupings",()=>{
    const report:TransactionReport={fromDate:"2026-09-01",toDate:"2026-09-30",incomeMinor:200000,spendingMinor:80000,netMinor:120000,savingsRatePercent:60,transactionCount:2,months:[{month:"2026-09",incomeMinor:200000,spendingMinor:80000,netMinor:120000}],categories:[{key:"housing",label:"Housing",amountMinor:80000,transactionCount:1,contributions:[]}],payees:[{key:"rent",label:"Landlord",amountMinor:80000,transactionCount:1,contributions:[]}]};
    const csv=buildReportCsv({report,currency:"USD",accountLabel:"All USD accounts",fromDate:"2026-09-01",toDate:"2026-09-30"});
    expect(csv).toContain('"Income",2000.00');expect(csv).toContain('"2026-09",2000.00,800.00,1200.00');expect(csv).toContain('"Housing",800.00,1');expect(csv).toContain('"Landlord",800.00,1');
    expect(exportFileName("HomeLedger report","2026-09-01","2026-09-30")).toBe("HomeLedger-report-2026-09-01-to-2026-09-30.csv");
  });
});
