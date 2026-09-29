import {describe,expect,it} from "vitest";
import {buildPreview,suggestMapping,suggestParsingOptions} from "./csvImport";
import {isPdfComplete,pdfExampleFields,pdfLayoutFromFieldRoles,pdfTextToTable,representativePdfLines,suggestPdfLayout} from "./pdfImport";

function preview(text:string,layout:Parameters<typeof pdfTextToTable>[1]){
  const parsed=pdfTextToTable(text,layout),mapping=suggestMapping(parsed.table.headers);
  return{parsed,mapping,rows:buildPreview(parsed.table,mapping,[],suggestParsingOptions(parsed.table,mapping))};
}

describe("PDF statement recognition",()=>{
  it("parses RFCU-style trailing-minus transaction amounts before running balance",()=>{
    const text=[
      "Statement activity",
      "6/03/26 AFFINITY GROVE 70.62- 16,159.90",
      "6/03/26 CITI AUTOPAY 150.00- 16,009.90",
      "6/03/26 PAYPAL 3.99- 16,005.91"
    ].join("\n");
    const {parsed,rows}=preview(text,"signed-before-balance");
    expect(parsed).toMatchObject({candidateRowCount:3,matchedRowCount:3,unmatchedLineNumbers:[],balanceMismatchLineNumbers:[]});
    expect(rows.map(row=>({payee:row.payee,amountMinor:row.amountMinor}))).toEqual([
      {payee:"AFFINITY GROVE",amountMinor:-7062},
      {payee:"CITI AUTOPAY",amountMinor:-15000},
      {payee:"PAYPAL",amountMinor:-399}
    ]);
    expect(rows.map(row=>row.payee)).not.toContain(expect.stringContaining("70.62"));
  });

  it("supports positive transaction amounts followed by a running balance, including Deposit Transfer",()=>{
    const text="Statement activity\n11/17/25 TO XX612-031 308.80- 2,842.55\n11/21/25 Deposit Transfer 620.00 3,462.55";
    const {parsed,rows}=preview(text,"signed-before-balance");
    expect(parsed).toMatchObject({candidateRowCount:2,matchedRowCount:2,unmatchedLineNumbers:[],balanceMismatchLineNumbers:[]});
    expect(rows.map(row=>({payee:row.payee,amountMinor:row.amountMinor}))).toEqual([
      {payee:"TO XX612-031",amountMinor:-30880},
      {payee:"Deposit Transfer",amountMinor:62000}
    ]);
  });

  it("exposes first-class example roles and accepts user field assignments",()=>{
    const line="6/03/26  CITI AUTOPAY  150.00-  15,929.95";
    expect(pdfExampleFields(line,"signed-before-balance")).toEqual([
      {text:"6/03/26",role:"date"},
      {text:"CITI AUTOPAY",role:"payee"},
      {text:"150.00-",role:"amount"},
      {text:"15,929.95",role:"balance"}
    ]);
    expect(pdfLayoutFromFieldRoles(["date","payee","amount","balance"])).toBe("signed-before-balance");
    expect(pdfLayoutFromFieldRoles(["date","payee","amount","ignore"])).toBe("signed-last");
    expect(pdfLayoutFromFieldRoles(["date","payee","debit","credit","balance"])).toBe("debit-credit-before-balance");
    expect(pdfLayoutFromFieldRoles(["date","payee","amount","debit","balance"])).toBeNull();
  });

  it("requires explicit direction for a one-amount bank row but permits taught amount-plus-balance",()=>{
    const text="Activity\n09/01/2026 Corner Market 12.34\n09/02/2026 Fuel 40.00";
    expect(pdfTextToTable(text,"signed-last")).toMatchObject({candidateRowCount:2,matchedRowCount:0,unmatchedLineNumbers:[2,3]});
    expect(preview(text,"expenses-last").rows.map(row=>row.amountMinor)).toEqual([-1234,-4000]);

    const withBalance="Activity\n09/01/2026 Deposit Transfer 12.34 100.00";
    expect(preview(withBalance,"signed-before-balance").rows[0]).toMatchObject({payee:"Deposit Transfer",amountMinor:1234});
  });

  it("shows rejected rows as teachable when tokenization succeeds and reruns counts by layout",()=>{
    const text="Activity\n09/01/2026 Corner Market 12.34 987.66\n09/02/2026 Fuel 40.00 947.66";
    const wrong=pdfTextToTable(text,"signed-last");
    expect(wrong).toMatchObject({candidateRowCount:2,matchedRowCount:0,unmatchedLineNumbers:[2,3]});
    expect(representativePdfLines(wrong,1)[0]).toMatchObject({lineNumber:2,matched:false,teachable:true});
    const taught=pdfTextToTable(text,"signed-before-balance");
    expect(taught).toMatchObject({candidateRowCount:2,matchedRowCount:2,unmatchedLineNumbers:[],balanceMismatchLineNumbers:[]});
  });

  it("uses running-balance continuity as deterministic validation when adjacent rows permit it",()=>{
    const good=pdfTextToTable("Activity\n6/03/26 Debit 70.62- 16,159.90\n6/03/26 Deposit Transfer 100.00 16,259.90","signed-before-balance");
    expect(good.balanceMismatchLineNumbers).toEqual([]);
    expect(isPdfComplete(good)).toBe(true);

    const bad=pdfTextToTable("Activity\n6/03/26 Debit 70.62- 16,159.90\n6/03/26 Deposit Transfer 100.00 99,999.99","signed-before-balance");
    expect(bad.balanceMismatchLineNumbers).toEqual([3]);
    expect(isPdfComplete(bad)).toBe(false);
  });

  it("keeps malformed exceptional dated rows fail-closed",()=>{
    const parsed=pdfTextToTable("Activity\n6/03/26 CITI AUTOPAY 150.00- 15,929.95\n6/04/26 Deposit Transfer AMOUNT OCR FAILED","signed-before-balance");
    expect(parsed).toMatchObject({candidateRowCount:2,matchedRowCount:1,unmatchedLineNumbers:[3]});
    expect(parsed.candidateLines[1]).toMatchObject({matched:false,teachable:false});
    expect(isPdfComplete(parsed)).toBe(false);
  });

  it("supports explicitly directed signed amounts without balances",()=>{
    const {parsed,rows}=preview("Account statement\n09/01/2026 Corner Market -$12.34\n09/02/2026 Payroll $1,500.00 CR\n09/04/2026 Utility (85.20)","signed-last");
    expect(parsed).toMatchObject({candidateRowCount:3,matchedRowCount:3,unmatchedLineNumbers:[]});
    expect(rows.map(row=>row.amountMinor)).toEqual([-1234,150000,-8520]);
  });

  it("supports separate debit and credit columns while requiring exactly one side per row",()=>{
    const text="Activity\n09/01/2026 Corner Market  12.34    \n09/02/2026 Payroll      1,500.00";
    const {parsed,mapping,rows}=preview(text,"debit-credit-last");
    expect(parsed).toMatchObject({candidateRowCount:2,matchedRowCount:2,unmatchedLineNumbers:[]});
    expect(mapping).toMatchObject({date:0,payee:1,amount:-1,debit:2,credit:3});
    expect(rows.map(row=>row.amountMinor)).toEqual([-1234,150000]);
  });

  it("distinguishes scanned documents from searchable documents without dated rows",()=>{
    expect(()=>pdfTextToTable("   \n")).toThrow("no searchable text");
    expect(pdfTextToTable("Searchable statement with an unsigned balance of 123.45")).toMatchObject({candidateRowCount:0,matchedRowCount:0});
  });

  it("prefers a balance-aware layout for RFCU-style rows",()=>{
    expect(suggestPdfLayout("Activity\n6/03/26 CITI AUTOPAY 150.00- 15,929.95")).toBe("signed-before-balance");
  });
});
