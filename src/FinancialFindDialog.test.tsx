// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinancialFindDialog } from "./FinancialFindDialog";
import type { Account, Security, Transaction } from "./domain";

afterEach(cleanup);
const accounts:Account[]=[{id:"checking",name:"Checking",type:"checking",currency:"USD",balanceMinor:0,ownerLabel:"Household"}];
const transactions:Transaction[]=[{id:"t1",accountId:"checking",postedDate:"2026-09-12",payee:"Lowes",category:"Home Improvement",amountMinor:-8421,status:"cleared"}];

describe("Financial Find dialog",()=>{
 it("focuses search, supports keyboard selection, Enter, and Escape",async()=>{
   const user=userEvent.setup(),onClose=vi.fn(),onSelect=vi.fn();
   render(<FinancialFindDialog accounts={accounts} transactions={transactions} schedules={[]} securities={[]} onClose={onClose} onSelect={onSelect}/>);
   const input=screen.getByRole("textbox",{name:"Search your financial records"});
   expect(document.activeElement).toBe(input);
   await user.type(input,"low");
   expect(screen.getByRole("option",{name:/Lowes/})).toBeTruthy();
   await user.keyboard("{Enter}");
   expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({kind:"transaction",transactionId:"t1"}));
   await user.keyboard("{Escape}");
   expect(onClose).toHaveBeenCalled();
 });

 it("moves keyboard selection in the same order the grouped results are displayed",async()=>{
   const user=userEvent.setup(),onSelect=vi.fn();
   const groupedTransactions:Transaction[]=[{id:"t2",accountId:"checking",postedDate:"2026-09-13",payee:"MSFT Market",category:"Shopping",amountMinor:-1000,status:"cleared"}];
   const securities:Security[]=[{id:"sec1",securityType:"stock",name:"Microsoft Corporation",symbol:"MSFT",currency:"USD",archived:false}];
   render(<FinancialFindDialog accounts={accounts} transactions={groupedTransactions} schedules={[]} securities={securities} onClose={()=>undefined} onSelect={onSelect}/>);
   const input=screen.getByRole("textbox",{name:"Search your financial records"});
   await user.type(input,"msft");
   const options=screen.getAllByRole("option");
   expect(options[0].textContent).toContain("MSFT Market");
   expect(options[0].getAttribute("aria-selected")).toBe("true");
   await user.keyboard("{ArrowDown}{Enter}");
   expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({kind:"security",securityId:"sec1"}));
 });
});
