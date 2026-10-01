// @vitest-environment jsdom
import {cleanup,render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {ImportPage} from "./ImportPage";
import * as repositoryModule from "./repository";
import type {Account,ImportTransactionsInput} from "./domain";

const accounts:Account[]=[
  {id:"checking",name:"RFCU Checking",institution:"Rivertown Federal Credit Union",type:"checking",currency:"USD",balanceMinor:0,ownerLabel:"Household"},
  {id:"citi",name:"Citi Card",institution:"Citi",type:"credit",currency:"USD",balanceMinor:0,ownerLabel:"Household"},
  {id:"chase",name:"Chase Card",institution:"Chase",type:"credit",currency:"USD",balanceMinor:0,ownerLabel:"Household"},
];

afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe("statement import end-to-end review",()=>{
  beforeEach(()=>{
    vi.spyOn(repositoryModule.financeRepository,"listImportBatches").mockResolvedValue([]);
    vi.spyOn(repositoryModule.financeRepository,"listMerchantRules").mockResolvedValue([]);
    vi.spyOn(repositoryModule.financeRepository,"listImportProfiles").mockResolvedValue([]);
    vi.spyOn(repositoryModule.financeRepository,"listCategories").mockResolvedValue(["Utilities: Electric","Shopping"]);
    vi.spyOn(repositoryModule.financeRepository,"listPayees").mockResolvedValue(["PayPal","Arkansas Valley Electric"]);
    vi.spyOn(repositoryModule.financeRepository,"findScheduledOccurrenceMatches").mockResolvedValue([]);
  });

  it("lets a parsed candidate be corrected, remembered, and imported with raw provenance intact",async()=>{
    const user=userEvent.setup();
    const createRule=vi.spyOn(repositoryModule.financeRepository,"createMerchantRule").mockResolvedValue({
      id:"rule-1",name:"Remember ARKANSAS VALLEY",pattern:"ARKANSAS VALLEY",matchType:"exact",direction:"expense",
      renameTo:"Arkansas Valley Electric",category:"Utilities: Electric",priority:1000,enabled:true
    });
    let submitted:ImportTransactionsInput|undefined;
    vi.spyOn(repositoryModule.financeRepository,"importTransactions").mockImplementation(async input=>{
      submitted=input;return{batchId:"batch-1",importedCount:1,transactionIds:["txn-1"]};
    });
    const onImported=vi.fn().mockResolvedValue(undefined);
    render(<ImportPage accounts={accounts} transactions={[]} onImported={onImported}/>);
    const file=new File(["Date,Description,Amount\n6/03/26,ARKANSAS VALLEY,-79.95"],"statement.csv",{type:"text/csv"});
    await user.upload(screen.getByLabelText(/Choose a statement file/i),file);

    const raw=await screen.findByDisplayValue("ARKANSAS VALLEY");
    const row=raw.closest("tr")!;
    const payee=within(row).getByLabelText("Payee");
    await user.clear(payee);await user.type(payee,"Arkansas Valley Electric");
    const category=within(row).getByLabelText("Category");
    await user.type(category,"Utilities: Electric");
    await user.click(within(row).getByRole("button",{name:/^Remember exact$/i}));
    await waitFor(()=>expect(createRule).toHaveBeenCalled());
    expect(createRule.mock.calls[0][0]).toMatchObject({
      pattern:"ARKANSAS VALLEY",matchType:"exact",direction:"expense",renameTo:"Arkansas Valley Electric",category:"Utilities: Electric"
    });

    await user.click(screen.getByRole("button",{name:"Import 1"}));
    await waitFor(()=>expect(submitted).toBeTruthy());
    expect(submitted!.rows[0]).toMatchObject({
      postedDate:"2026-06-03",payee:"Arkansas Valley Electric",originalPayee:"ARKANSAS VALLEY",category:"Utilities: Electric",amountMinor:-7995
    });
    expect(onImported).toHaveBeenCalled();
  });

  it("shows repeated-row scope before applying a correction",async()=>{
    const user=userEvent.setup();
    vi.spyOn(repositoryModule.financeRepository,"importTransactions").mockResolvedValue({batchId:"b",importedCount:2,transactionIds:["1","2"]});
    render(<ImportPage accounts={accounts} transactions={[]} onImported={vi.fn().mockResolvedValue(undefined)}/>);
    const file=new File([["Date,Description,Amount","6/03/26,ARKANSAS VALLEY,-79.95","6/04/26,Arkansas-Valley,-82.00"].join("\n")],"statement.csv",{type:"text/csv"});
    await user.upload(screen.getByLabelText(/Choose a statement file/i),file);
    const payees=await screen.findAllByLabelText("Payee");
    await user.clear(payees[0]);await user.type(payees[0],"Arkansas Valley Electric");
    const apply=screen.getByRole("button",{name:/Apply to 2 matching rows in this import/i});
    expect(apply).toBeTruthy();
    await user.click(apply);
    await waitFor(()=>expect((payees[1] as HTMLInputElement).value).toBe("Arkansas Valley Electric"));
  });

  it("recognizes a known PayPal payee without inventing a category",async()=>{
    const user=userEvent.setup();
    render(<ImportPage accounts={accounts} transactions={[]} onImported={vi.fn().mockResolvedValue(undefined)}/>);
    const file=new File([["Date,Description,Amount","6/03/26,PAYPAL *XYZ,-47.99"].join("\n")],"statement.csv",{type:"text/csv"});
    await user.upload(screen.getByLabelText(/Choose a statement file/i),file);
    expect(await screen.findByDisplayValue("PayPal")).toBeTruthy();
    expect(screen.getByText(/Suggestion source: Recognized payee/i)).toBeTruthy();
    const category=screen.getByLabelText("Category") as HTMLInputElement;
    expect(category.value).toBe("");
  });

  it("suggests a credit-card transfer but only submits it after explicit acceptance",async()=>{
    const user=userEvent.setup();
    let submitted:ImportTransactionsInput|undefined;
    vi.spyOn(repositoryModule.financeRepository,"importTransactions").mockImplementation(async input=>{
      submitted=input;return{batchId:"batch-2",importedCount:1,transactionIds:["txn-2"]};
    });
    render(<ImportPage accounts={accounts} transactions={[]} onImported={vi.fn().mockResolvedValue(undefined)}/>);
    const file=new File(["Date,Description,Amount\n6/03/26,CITI AUTOPAY,-150.00"],"statement.csv",{type:"text/csv"});
    await user.upload(screen.getByLabelText(/Choose a statement file/i),file);

    const suggestion=await screen.findByText(/Possible transfer → Citi Card/i);
    expect(suggestion).toBeTruthy();
    expect(screen.queryByText(/Confirmed linked transfer with Citi Card/i)).toBeNull();
    await user.click(screen.getByRole("button",{name:/Accept transfer suggestion/i}));
    expect(await screen.findByText(/Confirmed linked transfer with Citi Card/i)).toBeTruthy();

    await user.click(screen.getByRole("button",{name:"Import 1"}));
    await waitFor(()=>expect(submitted).toBeTruthy());
    expect(submitted!.rows[0]).toMatchObject({
      payee:"CITI AUTOPAY",originalPayee:"CITI AUTOPAY",amountMinor:-15000,transferAccountId:"citi"
    });
    expect(submitted!.rows[0].scheduledOccurrenceId).toBeUndefined();
  });
});
