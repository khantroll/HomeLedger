// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {TransactionDialog} from "./TransactionDialog";
import {financeRepository as repo} from "./repository";
import type {Transaction} from "./domain";
const tx:Transaction={id:"t",accountId:"checking",postedDate:"2026-10-01",payee:"ARKANSAS VALLEY ELEC",category:"Uncategorized",amountMinor:-7995,status:"cleared",source:"manual"};
const accounts=[{id:"checking",name:"Checking",type:"checking" as const,currency:"USD",balanceMinor:100000,ownerLabel:"Household"}];
beforeEach(()=>{
 vi.spyOn(repo,"listCategories").mockResolvedValue([]);vi.spyOn(repo,"listPayees").mockResolvedValue([]);
 vi.spyOn(repo,"listTransactionAttachments").mockResolvedValue([]);vi.spyOn(repo,"listMerchantRules").mockResolvedValue([]);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function correct(){const user=userEvent.setup();await user.clear(screen.getByLabelText("Payee"));await user.type(screen.getByLabelText("Payee"),"Arkansas Valley Electric");await user.click(screen.getByRole("button",{name:"Save"}));return user;}
function show(){const onSaved=vi.fn(async()=>{});render(<TransactionDialog accounts={accounts} transaction={tx} onClose={()=>{}} onSaved={onSaved}/>);return onSaved;}
describe("correction → remember editor",()=>{
 it("saves first and allows just this one without persistent learning",async()=>{
  const update=vi.spyOn(repo,"updateTransaction").mockResolvedValue({...tx,payee:"Arkansas Valley Electric",originalPayee:tx.payee});
  const create=vi.spyOn(repo,"createMerchantRule");const onSaved=show(),user=await correct();
  expect(update).toHaveBeenCalledTimes(1);expect(create).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Just this one"}));expect(onSaved).toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
 });
 it("remembers explicitly using the existing rule repository",async()=>{
  vi.spyOn(repo,"updateTransaction").mockResolvedValue(tx);
  const create=vi.spyOn(repo,"createMerchantRule").mockResolvedValue({id:"rule",name:"r",pattern:tx.payee,matchType:"exact",direction:"expense",priority:1000,enabled:true,origin:"remembered"});
  const onSaved=show(),user=await correct();await user.click(screen.getByRole("button",{name:"Remember"}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalled());expect(create).toHaveBeenCalledWith(expect.objectContaining({pattern:tx.payee,origin:"remembered",renameTo:"Arkansas Valley Electric",category:undefined}));
 });
 it("opens the existing custom rule dialog with manual precedence",async()=>{
  vi.spyOn(repo,"updateTransaction").mockResolvedValue(tx);show();const user=await correct();
  await user.click(screen.getByRole("button",{name:"Customize rule"}));expect(screen.getByRole("heading",{name:"Create merchant rule"})).toBeTruthy();
 });
 it("offers no learning after a protected mutation is rejected",async()=>{
  vi.spyOn(repo,"updateTransaction").mockRejectedValue(new Error("Transactions linked to scheduled occurrences cannot be edited"));
  const create=vi.spyOn(repo,"createMerchantRule");show();await correct();
  expect(await screen.findByText("Transactions linked to scheduled occurrences cannot be edited")).toBeTruthy();expect(screen.queryByRole("button",{name:"Remember"})).toBeNull();expect(create).not.toHaveBeenCalled();
 });
 it("keeps a failed rule save retry separate from the already saved transaction",async()=>{
  const update=vi.spyOn(repo,"updateTransaction").mockResolvedValue(tx),create=vi.spyOn(repo,"createMerchantRule").mockRejectedValueOnce(new Error("Disk unavailable")).mockResolvedValueOnce({id:"r",name:"r",pattern:tx.payee,matchType:"exact",direction:"expense",priority:1000,enabled:true});
  const onSaved=show(),user=await correct();await user.click(screen.getByRole("button",{name:"Remember"}));expect(await screen.findByRole("alert")).toBeTruthy();
  await user.click(screen.getByRole("button",{name:"Remember"}));await waitFor(()=>expect(onSaved).toHaveBeenCalled());expect(update).toHaveBeenCalledTimes(1);expect(create).toHaveBeenCalledTimes(2);
 });
});
