// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import type {Account,HoldingSnapshot,InvestmentEventInput,InvestmentEventRevision,Security} from "./domain";

vi.mock("./repository",()=>({investmentRepository:{createInvestmentAccount:vi.fn(),createSecurity:vi.fn(),createInvestmentEvent:vi.fn(),updatePendingInvestmentEvent:vi.fn(),correctHistoricalInvestmentEvent:vi.fn(),setSpecificLotAllocations:vi.fn()}}));
import {InvestmentAccountDialog,InvestmentActivityDialog,SecurityDialog,parseInvestmentQuantity} from "./InvestmentEditors";
import {investmentRepository} from "./repository";

const account:Account={id:"inv",name:"Brokerage",type:"investment",currency:"USD",balanceMinor:0,ownerLabel:"Household",archived:false};
const destination:Account={id:"dest",name:"IRA",type:"investment",currency:"USD",balanceMinor:0,ownerLabel:"Household",archived:false};
const security:Security={id:"sec",name:"Example Corp",symbol:"EXM",securityType:"stock",currency:"USD",archived:false};
const holding:HoldingSnapshot={accountId:"inv",securityId:"sec",quantityE8:300_000_000,knownBasisMinor:30000,unknownBasisQuantityE8:0,incompleteUnknownBasis:false,lots:[{acquisitionEventId:"lot1",acquisitionDate:"2025-01-01",quantityE8:100_000_000,basisMinor:10000},{acquisitionEventId:"lot2",acquisitionDate:undefined,quantityE8:200_000_000,basisMinor:undefined}],realized:{knownBasisQuantityE8:0,knownDisposedBasisMinor:0,calculableProceedsMinor:0,calculableGainMinor:0,unknownBasisQuantityE8:0,unknownBasisProceedsMinor:0,incompleteUnknownBasis:false}};
function saved(input:InvestmentEventInput,id="e1"):InvestmentEventRevision{return{...input,id:"r1",eventId:id,revisionNumber:1};}
function field(container:HTMLElement,name:string){const el=container.querySelector('[name="'+name+'"]') as HTMLInputElement|HTMLSelectElement|null;if(!el)throw new Error("Missing field "+name);return el;}
async function submitActivity(kind:string,values:Record<string,string>={}){
 vi.mocked(investmentRepository.createInvestmentEvent).mockImplementation(async input=>saved(input));
 const view=render(<InvestmentActivityDialog account={account} accounts={[account,destination]} securities={[security]} holdings={[holding]} onClose={()=>{}} onSaved={()=>{}}/>);
 fireEvent.change(field(view.container,"activity"),{target:{value:kind}});
 for(const [name,value] of Object.entries(values))fireEvent.change(field(view.container,name),{target:{value}});
 fireEvent.submit(view.container.querySelector("form")!);
 await waitFor(()=>expect(investmentRepository.createInvestmentEvent).toHaveBeenCalled());
 const input=vi.mocked(investmentRepository.createInvestmentEvent).mock.calls.at(-1)![0];
 view.unmount();vi.mocked(investmentRepository.createInvestmentEvent).mockClear();
 return input;
}
beforeEach(()=>{
 vi.mocked(investmentRepository.createInvestmentAccount).mockResolvedValue({accountId:"new-investment",accountKind:"brokerage",taxTreatment:"unknown",defaultLotMethod:"fifo",openingCashMinor:0,openingDate:"2026-09-22"});
 vi.mocked(investmentRepository.createSecurity).mockResolvedValue(security);
 vi.mocked(investmentRepository.updatePendingInvestmentEvent).mockImplementation(async(_,input)=>saved(input));
 vi.mocked(investmentRepository.correctHistoricalInvestmentEvent).mockImplementation(async(_,input)=>saved(input));
 vi.mocked(investmentRepository.setSpecificLotAllocations).mockResolvedValue();
});
afterEach(()=>{cleanup();vi.clearAllMocks();});

describe("investment setup editors",()=>{
 it("creates investment accounts only through the Foundation API",async()=>{const onSaved=vi.fn();const view=render(<InvestmentAccountDialog onClose={()=>{}} onSaved={onSaved}/>);fireEvent.change(field(view.container,"name"),{target:{value:"My Brokerage"}});fireEvent.submit(view.container.querySelector("form")!);await waitFor(()=>expect(investmentRepository.createInvestmentAccount).toHaveBeenCalled());expect(investmentRepository.createInvestmentAccount).toHaveBeenCalledWith(expect.objectContaining({name:"My Brokerage",currency:"USD",openingCashMinor:0,accountKind:"brokerage"}));expect(onSaved).toHaveBeenCalledWith("new-investment");});
 it("creates an offline manual security without provider/network dependency",async()=>{const network=vi.spyOn(globalThis,"fetch");const view=render(<SecurityDialog account={account} onClose={()=>{}} onSaved={()=>{}}/>);fireEvent.change(field(view.container,"name"),{target:{value:"Private Company"}});fireEvent.change(field(view.container,"symbol"),{target:{value:"PRIV"}});fireEvent.submit(view.container.querySelector("form")!);await waitFor(()=>expect(investmentRepository.createSecurity).toHaveBeenCalledWith(expect.objectContaining({name:"Private Company",symbol:"PRIV",currency:"USD"})));expect(network).not.toHaveBeenCalled();network.mockRestore();});
});

describe("Money-style activity mapping",()=>{
 it("maps Buy, FIFO Sell, Dividend, reinvestment, Interest and Fee to existing Foundation semantics",async()=>{
  expect(await submitActivity("buy",{quantity:"2",amount:"100.00",fee:"1.00"})).toMatchObject({eventType:"buy",quantityE8:200_000_000,acquisitionFundingMinor:10000,feeMinor:100,cashEffectMinor:-10100});
  expect(await submitActivity("sell",{quantity:"1",amount:"80.00",fee:"2.00"})).toMatchObject({eventType:"sell",quantityE8:100_000_000,grossCashMinor:8000,feeMinor:200,cashEffectMinor:7800});
  expect(await submitActivity("dividend",{amount:"5.00"})).toMatchObject({eventType:"dividend",incomeMinor:500,cashEffectMinor:500});
  expect(await submitActivity("reinvest_dividend",{quantity:"0.25",amount:"5.00"})).toMatchObject({eventType:"reinvest_dividend",quantityE8:25_000_000,incomeMinor:500,acquisitionFundingMinor:500,cashEffectMinor:0});
  expect(await submitActivity("interest",{amount:"2.50"})).toMatchObject({eventType:"interest",securityId:undefined,incomeMinor:250,cashEffectMinor:250});
  expect(await submitActivity("fee",{amount:"1.25"})).toMatchObject({eventType:"fee",securityId:undefined,feeMinor:125,cashEffectMinor:-125});
 });
 it("maps split/reverse split, return of capital, basis adjustment, and supported investment transfers",async()=>{
  expect(await submitActivity("split",{numerator:"1",denominator:"2"})).toMatchObject({eventType:"split",splitNumerator:1,splitDenominator:2});
  expect(await submitActivity("return_of_capital",{amount:"10.00"})).toMatchObject({eventType:"return_of_capital",cashEffectMinor:1000,basisEffectMinor:-1000});
  expect(await submitActivity("basis_adjustment",{amount:"-3.00"})).toMatchObject({eventType:"basis_adjustment",basisEffectMinor:-300,cashEffectMinor:0});
  expect(await submitActivity("cash_transfer",{amount:"20.00",destination:"dest"})).toMatchObject({eventType:"cash_transfer",relatedAccountId:"dest",cashEffectMinor:-2000,securityId:undefined});
  expect(await submitActivity("security_transfer",{quantity:"1.5",destination:"dest"})).toMatchObject({eventType:"security_transfer",relatedAccountId:"dest",quantityE8:150_000_000,securityId:"sec"});
 });
 it("preserves known and unknown opening-position basis/acquisition facts",async()=>{
  const known=await submitActivity("opening_position",{quantity:"3",basis:"150.00",acquisitionDate:"2020-01-02"});expect(known).toMatchObject({eventType:"opening_position",quantityE8:300_000_000,grossCashMinor:15000,acquisitionDate:"2020-01-02",cashEffectMinor:0});
  const unknown=await submitActivity("opening_position",{quantity:"3",basis:"",acquisitionDate:""});expect(unknown.grossCashMinor).toBeUndefined();expect(unknown.acquisitionDate).toBeUndefined();
 });
 it("uses explicit specific-lot allocations before clearing a sale",async()=>{vi.mocked(investmentRepository.createInvestmentEvent).mockImplementation(async input=>saved(input,"sale"));const view=render(<InvestmentActivityDialog account={account} accounts={[account,destination]} securities={[security]} holdings={[holding]} onClose={()=>{}} onSaved={()=>{}}/>);fireEvent.change(field(view.container,"activity"),{target:{value:"sell"}});fireEvent.change(field(view.container,"quantity"),{target:{value:"1"}});fireEvent.change(field(view.container,"amount"),{target:{value:"75.00"}});fireEvent.click(screen.getByLabelText("Specific lots"));fireEvent.change(field(view.container,"lot-lot1"),{target:{value:"1"}});fireEvent.submit(view.container.querySelector("form")!);await waitFor(()=>expect(investmentRepository.setSpecificLotAllocations).toHaveBeenCalledWith("sale",[{acquisitionEventId:"lot1",quantityE8:100_000_000}]));expect(investmentRepository.createInvestmentEvent).toHaveBeenCalledWith(expect.objectContaining({eventType:"sell",status:"pending"}));expect(investmentRepository.updatePendingInvestmentEvent).toHaveBeenCalledWith("sale",expect.objectContaining({status:"cleared"}));});
 it("edits pending activity directly and corrects protected history non-destructively",async()=>{const pending=saved({accountId:"inv",eventType:"dividend",tradeDate:"2026-01-01",securityId:"sec",cashEffectMinor:500,incomeMinor:500,acquisitionFundingMinor:0,feeMinor:0,basisEffectMinor:0,status:"pending",source:"manual"},"pending");let view=render(<InvestmentActivityDialog account={account} accounts={[account,destination]} securities={[security]} holdings={[holding]} event={pending} onClose={()=>{}} onSaved={()=>{}}/>);fireEvent.submit(view.container.querySelector("form")!);await waitFor(()=>expect(investmentRepository.updatePendingInvestmentEvent).toHaveBeenCalledWith("pending",expect.objectContaining({eventType:"dividend"})));view.unmount();const cleared={...pending,eventId:"cleared",status:"cleared" as const};view=render(<InvestmentActivityDialog account={account} accounts={[account,destination]} securities={[security]} holdings={[holding]} event={cleared} onClose={()=>{}} onSaved={()=>{}}/>);fireEvent.change(field(view.container,"correctionReason"),{target:{value:"Corrected statement"}});fireEvent.submit(view.container.querySelector("form")!);await waitFor(()=>expect(investmentRepository.correctHistoricalInvestmentEvent).toHaveBeenCalledWith("cleared",expect.objectContaining({status:"cleared"}),"Corrected statement"));});
 it("rejects unsupported quantity precision before repository mutation",async()=>{const view=render(<InvestmentActivityDialog account={account} accounts={[account,destination]} securities={[security]} holdings={[holding]} onClose={()=>{}} onSaved={()=>{}}/>);fireEvent.change(field(view.container,"quantity"),{target:{value:"1.123456789"}});fireEvent.change(field(view.container,"amount"),{target:{value:"10.00"}});fireEvent.submit(view.container.querySelector("form")!);expect(await screen.findByText(/no more than 8 decimal places/)).toBeTruthy();expect(investmentRepository.createInvestmentEvent).not.toHaveBeenCalled();});
 it("parses exact eight-decimal quantities without exposing E8 to users",()=>{expect(parseInvestmentQuantity("1.23456789")).toBe(123_456_789);expect(()=>parseInvestmentQuantity("1.234567891")).toThrow();});
});