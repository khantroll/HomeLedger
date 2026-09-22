// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Account, PortfolioSnapshot } from "./domain";

vi.mock("./repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository")>();
  return { ...actual, isNativeApp:true, investmentRepository:{ ...actual.investmentRepository, calculatePortfolioSnapshot:vi.fn(), listSecurities:vi.fn(), listInvestmentEvents:vi.fn(), listSecurityPrices:vi.fn(), addManualSecurityPrice:vi.fn(), createSecurity:vi.fn(), createInvestmentEvent:vi.fn(), updatePendingInvestmentEvent:vi.fn(), correctHistoricalInvestmentEvent:vi.fn(), setSpecificLotAllocations:vi.fn() } };
});

import { PortfolioPage } from "./PortfolioPage";
import { investmentRepository, normalizeInvestmentEvent, normalizePortfolioSnapshot, normalizeSecurityPrice } from "./repository";

beforeEach(()=>{vi.mocked(investmentRepository.listSecurityPrices).mockResolvedValue([]);});
afterEach(()=>{cleanup();vi.clearAllMocks();});

const accounts:Account[]=[
  {id:"inv",name:"Household Brokerage",type:"investment",currency:"USD",balanceMinor:0,ownerLabel:"Household",archived:false},
  {id:"dest",name:"Rollover IRA",type:"investment",currency:"USD",balanceMinor:0,ownerLabel:"Household",archived:false},
];

describe("Market refresh remains explicit",()=>{
 it("opening Portfolio and changing As-of make no market-data request",async()=>{const network=vi.spyOn(globalThis,"fetch");vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue({asOfDate:"2026-09-21",accounts:[]});vi.mocked(investmentRepository.listSecurities).mockResolvedValue([]);render(<PortfolioPage accounts={accounts} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);await screen.findByText("Update prices");expect(network).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Choose date"}));fireEvent.change(screen.getByLabelText("Historical as of date"),{target:{value:"2026-01-15"}});await vi.waitFor(()=>expect(investmentRepository.calculatePortfolioSnapshot).toHaveBeenCalledWith(expect.any(Array),"2026-01-15"));expect(network).not.toHaveBeenCalled();network.mockRestore();});
});

describe("Portfolio native nullable snapshot boundary",()=>{
  it("keeps native null valuations visibly unknown instead of formatting them as zero",async()=>{
    const nativeSnapshot={
      asOfDate:"2026-09-21",
      accounts:[{
        accountId:"inv",
        cashMinor:2500,
        holdingsValueMinor:null,
        totalValueMinor:null,
        holdings:[{
          accountId:"inv",
          securityId:"sec",
          quantityE8:100_000_000,
          knownBasisMinor:10000,
          unknownBasisQuantityE8:0,
          priceE8:null,
          priceObservedAt:null,
          marketValueMinor:null,
          unrealizedGainMinor:null,
          incompleteUnknownBasis:false,
          lots:[{acquisitionEventId:"buy",acquisitionDate:null,quantityE8:100_000_000,basisMinor:10000}],
          realized:{knownBasisQuantityE8:0,knownDisposedBasisMinor:0,calculableProceedsMinor:0,calculableGainMinor:0,unknownBasisQuantityE8:0,unknownBasisProceedsMinor:0,incompleteUnknownBasis:false},
        }],
      }],
    };
    const normalized=normalizePortfolioSnapshot(nativeSnapshot);
    expect(normalized.accounts[0].holdingsValueMinor).toBeUndefined();
    expect(normalized.accounts[0].totalValueMinor).toBeUndefined();
    expect(normalized.accounts[0].holdings[0].priceE8).toBeUndefined();
    expect(normalized.accounts[0].holdings[0].marketValueMinor).toBeUndefined();
    expect(normalized.accounts[0].holdings[0].unrealizedGainMinor).toBeUndefined();

    vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue(normalized);
    vi.mocked(investmentRepository.listSecurities).mockResolvedValue([{id:"sec",securityType:"stock",name:"Example Corp",symbol:"EXM",currency:"USD",archived:false}]);
    vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([]);

    render(<PortfolioPage accounts={accounts} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);

    const row=(await screen.findAllByText("EXM")).map(node=>node.closest("tr")).find(Boolean) as HTMLTableRowElement|undefined;
    expect(row).toBeTruthy();
    if(!row)throw new Error("Holding row was not rendered");
    expect(within(row).getByText("Price needed")).toBeTruthy();
    expect(within(row).getAllByText("Unknown").length).toBeGreaterThanOrEqual(3);
    expect(within(row).queryByText("$0.00")).toBeNull();

    const investments=screen.getByText("Investments").closest(".summary") as HTMLElement|null;
    const portfolioValue=screen.getByText("Portfolio value").closest(".summary") as HTMLElement|null;
    expect(investments&&within(investments).getByText("Unknown")).toBeTruthy();
    expect(portfolioValue&&within(portfolioValue).getByText("Unknown")).toBeTruthy();

    const weightCell=within(row).getAllByRole("cell")[7];
    expect(within(weightCell).getByText("Unknown")).toBeTruthy();
  });
});


describe("Investment account workspace",()=>{
 const snapshot:PortfolioSnapshot={asOfDate:"2026-09-21",accounts:[{accountId:"inv",cashMinor:5000,holdingsValueMinor:12500,totalValueMinor:17500,holdings:[{accountId:"inv",securityId:"sec",quantityE8:100_000_000,knownBasisMinor:10000,unknownBasisQuantityE8:0,priceE8:125_000_000,priceObservedAt:"2026-09-20",marketValueMinor:12500,unrealizedGainMinor:2500,incompleteUnknownBasis:false,lots:[{acquisitionEventId:"buy",acquisitionDate:"2026-01-02",quantityE8:100_000_000,basisMinor:10000}],realized:{knownBasisQuantityE8:0,knownDisposedBasisMinor:0,calculableProceedsMinor:0,calculableGainMinor:0,unknownBasisQuantityE8:0,unknownBasisProceedsMinor:0,incompleteUnknownBasis:false}}]}]};
 const security={id:"sec",securityType:"stock" as const,name:"Example Corp",symbol:"EXM",currency:"USD",archived:false};
 const buy={id:"r1",eventId:"e1",revisionNumber:1,accountId:"inv",eventType:"buy" as const,tradeDate:"2026-01-02",securityId:"sec",quantityE8:100_000_000,grossCashMinor:10000,cashEffectMinor:-10000,incomeMinor:0,acquisitionFundingMinor:10000,feeMinor:0,basisEffectMinor:0,status:"cleared" as const,source:"manual" as const};
 const dividend={id:"r2",eventId:"e2",revisionNumber:1,accountId:"inv",eventType:"dividend" as const,tradeDate:"2026-06-01",securityId:"sec",cashEffectMinor:500,incomeMinor:500,acquisitionFundingMinor:0,feeMinor:0,basisEffectMinor:0,status:"cleared" as const,source:"manual" as const};
 it("scopes account views and presents activity and intrinsic cash history",async()=>{
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue(snapshot);
  vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);
  vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([dividend,buy]);
  render(<PortfolioPage accounts={accounts} focus={{accountId:"inv"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);
  expect(await screen.findByText("Account value")).toBeTruthy();
  expect(investmentRepository.calculatePortfolioSnapshot).toHaveBeenCalledWith(["inv"],expect.any(String));
  expect(investmentRepository.listInvestmentEvents).toHaveBeenCalledWith("inv",undefined,expect.any(String));
  fireEvent.click(screen.getByRole("button",{name:"Activity"}));
  expect(screen.getByText("Dividend from EXM")).toBeTruthy();expect(screen.getByText("Bought 1 EXM")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Cash"}));
  expect(screen.getByText("Cash held in this investment account")).toBeTruthy();expect(screen.getAllByText("$50.00").length).toBeGreaterThanOrEqual(1);expect(screen.getByText("Income $5.00")).toBeTruthy();
 });
 it("shows security detail with position, activity, and expandable lot provenance",async()=>{
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue(snapshot);vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([buy]);
  render(<PortfolioPage accounts={accounts} focus={{accountId:"inv",securityId:"sec"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);
  expect(await screen.findByText("Security detail")).toBeTruthy();expect(screen.getByText("Market value")).toBeTruthy();expect(screen.getByText("Bought 1 EXM")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:/Lots/}));expect(screen.getByText(/Acquired Jan 2, 2026/)).toBeTruthy();
 });
 it("preserves unknown and partial security states",async()=>{
  const unknown=structuredClone(snapshot);const h=unknown.accounts[0].holdings[0];h.priceE8=undefined;h.priceObservedAt=undefined;h.marketValueMinor=undefined;h.unrealizedGainMinor=undefined;h.unknownBasisQuantityE8=50_000_000;h.incompleteUnknownBasis=true;h.lots=[{acquisitionEventId:"open",acquisitionDate:undefined,quantityE8:50_000_000,basisMinor:undefined}];unknown.accounts[0].holdingsValueMinor=undefined;unknown.accounts[0].totalValueMinor=undefined;
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue(unknown);vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([]);
  render(<PortfolioPage accounts={accounts} focus={{accountId:"inv",securityId:"sec"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);
  expect(await screen.findByText("Price needed")).toBeTruthy();expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);expect(screen.getByText(/Partial — some basis is unknown/)).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:/Lots/}));expect(screen.getByText(/Acquired Unknown acquisition date/)).toBeTruthy();expect(screen.getByText("Unknown basis")).toBeTruthy();
 });

 it("shows investment transfers in both accounts with correct direction and cash movement",async()=>{
  const cashTransfer={id:"rt1",eventId:"t1",revisionNumber:1,accountId:"inv",eventType:"cash_transfer" as const,tradeDate:"2026-07-01",relatedAccountId:"dest",cashEffectMinor:-2500,incomeMinor:0,acquisitionFundingMinor:0,feeMinor:0,basisEffectMinor:0,status:"cleared" as const,source:"manual" as const};
  const securityTransfer={id:"rt2",eventId:"t2",revisionNumber:1,accountId:"inv",eventType:"security_transfer" as const,tradeDate:"2026-07-02",securityId:"sec",relatedAccountId:"dest",quantityE8:100_000_000,cashEffectMinor:0,incomeMinor:0,acquisitionFundingMinor:0,feeMinor:0,basisEffectMinor:0,status:"cleared" as const,source:"manual" as const};
  const sourceSnapshot:PortfolioSnapshot={...snapshot,accounts:[{...snapshot.accounts[0],accountId:"inv",cashMinor:2500}]};
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue(sourceSnapshot);vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([securityTransfer,cashTransfer]);
  const source=render(<PortfolioPage accounts={accounts} focus={{accountId:"inv"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);
  await screen.findByText("Account value");fireEvent.click(screen.getByRole("button",{name:"Activity"}));expect(screen.getByText("Transferred cash out")).toBeTruthy();expect(screen.getByText("Transferred out 1 EXM")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Cash"}));expect(screen.getByText("-$25.00")).toBeTruthy();source.unmount();

  const destSnapshot:PortfolioSnapshot={...snapshot,accounts:[{...snapshot.accounts[0],accountId:"dest",cashMinor:2500,holdings:[{...snapshot.accounts[0].holdings[0],accountId:"dest"}]}]};
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue(destSnapshot);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([securityTransfer,cashTransfer]);
  render(<PortfolioPage accounts={accounts} focus={{accountId:"dest"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);
  await screen.findByText("Account value");fireEvent.click(screen.getByRole("button",{name:"Activity"}));const incoming=screen.getByText("Transferred cash in").closest("article") as HTMLElement|null;expect(incoming).toBeTruthy();if(!incoming)throw new Error("Destination cash transfer activity was not rendered");expect(within(incoming).getByText("$25.00")).toBeTruthy();expect(within(incoming).queryByText("-$25.00")).toBeNull();expect(screen.getByText("Transferred in 1 EXM")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Cash"}));expect(screen.getAllByText("$25.00").length).toBeGreaterThanOrEqual(1);
 });
 it("shows transferred-in security activity in destination security detail",async()=>{
  const securityTransfer={id:"rt2",eventId:"t2",revisionNumber:1,accountId:"inv",eventType:"security_transfer" as const,tradeDate:"2026-07-02",securityId:"sec",relatedAccountId:"dest",quantityE8:100_000_000,cashEffectMinor:0,incomeMinor:0,acquisitionFundingMinor:0,feeMinor:0,basisEffectMinor:0,status:"cleared" as const,source:"manual" as const};
  const destSnapshot:PortfolioSnapshot={...snapshot,accounts:[{...snapshot.accounts[0],accountId:"dest",holdings:[{...snapshot.accounts[0].holdings[0],accountId:"dest"}]}]};
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue(destSnapshot);vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([securityTransfer]);
  render(<PortfolioPage accounts={accounts} focus={{accountId:"dest",securityId:"sec"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);
  expect(await screen.findByText("Security detail")).toBeTruthy();expect(screen.getByText("Transferred in 1 EXM")).toBeTruthy();
 });

 it("persists a manual price observation without creating investment activity",async()=>{
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue(snapshot);vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([buy]);vi.mocked(investmentRepository.listSecurityPrices).mockResolvedValue([]);
  vi.mocked(investmentRepository.addManualSecurityPrice).mockResolvedValue({id:"p",securityId:"sec",observedAt:"2026-09-20",priceE8:123_450_000,currency:"USD",source:"manual",provenance:"Manual entry"});
  render(<PortfolioPage accounts={accounts} focus={{accountId:"inv",securityId:"sec"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);await screen.findByText("Security detail");
  fireEvent.change(screen.getByLabelText("Manual price"),{target:{value:"1.2345"}});fireEvent.change(screen.getByLabelText("Price observation date"),{target:{value:"2026-09-21"}});fireEvent.submit(screen.getByRole("button",{name:"Update price"}).closest("form")!);
  await vi.waitFor(()=>expect(investmentRepository.addManualSecurityPrice).toHaveBeenCalledWith({securityId:"sec",observedAt:"2026-09-21",priceE8:123450000,currency:"USD",provenance:"Manual entry"}));
 });
 it("bounds manual price entry to a historical as-of date while allowing that date",async()=>{
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockImplementation(async(_ids,date)=>({...snapshot,asOfDate:date}));vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([]);vi.mocked(investmentRepository.addManualSecurityPrice).mockResolvedValue({id:"p",securityId:"sec",observedAt:"2026-01-15",priceE8:123_000_000,currency:"USD",source:"manual"});
  render(<PortfolioPage accounts={accounts} focus={{accountId:"inv",securityId:"sec"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);await screen.findByText("Security detail");fireEvent.click(screen.getByRole("button",{name:"Choose date"}));fireEvent.change(screen.getByLabelText("Historical as of date"),{target:{value:"2026-01-15"}});await vi.waitFor(()=>expect((screen.getByLabelText("Price observation date") as HTMLInputElement).max).toBe("2026-01-15"));
  fireEvent.change(screen.getByLabelText("Manual price"),{target:{value:"1.23"}});fireEvent.change(screen.getByLabelText("Price observation date"),{target:{value:"2026-01-16"}});fireEvent.submit(screen.getByRole("button",{name:"Update price"}).closest("form")!);expect((await screen.findByRole("alert")).textContent).toBe("Observation date cannot be after the selected as-of date.");expect(investmentRepository.addManualSecurityPrice).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Price observation date"),{target:{value:"2026-01-15"}});fireEvent.submit(screen.getByRole("button",{name:"Update price"}).closest("form")!);await vi.waitFor(()=>expect(investmentRepository.addManualSecurityPrice).toHaveBeenCalledWith({securityId:"sec",observedAt:"2026-01-15",priceE8:123000000,currency:"USD",provenance:"Manual entry"}));
 });
 it("allows today's observation in the Today view",async()=>{
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue(snapshot);vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([]);vi.mocked(investmentRepository.addManualSecurityPrice).mockResolvedValue({id:"today",securityId:"sec",observedAt:"2026-09-21",priceE8:200_000_000,currency:"USD",source:"manual"});
  render(<PortfolioPage accounts={accounts} focus={{accountId:"inv",securityId:"sec"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);await screen.findByText("Security detail");const today=(screen.getByLabelText("Price observation date") as HTMLInputElement).max;expect((screen.getByLabelText("Price observation date") as HTMLInputElement).value).toBe(today);fireEvent.change(screen.getByLabelText("Manual price"),{target:{value:"2"}});fireEvent.submit(screen.getByRole("button",{name:"Update price"}).closest("form")!);await vi.waitFor(()=>expect(investmentRepository.addManualSecurityPrice).toHaveBeenCalledWith(expect.objectContaining({observedAt:today,priceE8:200000000})));
 });
 it("recomputes historical snapshots and bounds activity to the selected as-of date",async()=>{
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockImplementation(async(_ids,date)=>({...snapshot,asOfDate:date}));vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([]);
  render(<PortfolioPage accounts={accounts} focus={{accountId:"inv"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);await screen.findByText("Account value");fireEvent.click(screen.getByRole("button",{name:"Choose date"}));fireEvent.change(screen.getByLabelText("Historical as of date"),{target:{value:"2026-01-15"}});
  await vi.waitFor(()=>expect(investmentRepository.calculatePortfolioSnapshot).toHaveBeenCalledWith(["inv"],"2026-01-15"));expect(investmentRepository.listInvestmentEvents).toHaveBeenCalledWith("inv",undefined,"2026-01-15");
 });
 it("keeps missing historical valuation unknown and does not leak future observations",async()=>{
  const historical:PortfolioSnapshot={asOfDate:"2026-01-15",accounts:[{...snapshot.accounts[0],holdingsValueMinor:undefined,totalValueMinor:undefined,holdings:[{...snapshot.accounts[0].holdings[0],priceE8:undefined,priceObservedAt:undefined,marketValueMinor:undefined,unrealizedGainMinor:undefined}]}]};
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockImplementation(async(_ids,date)=>date==="2026-01-15"?historical:snapshot);vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([]);vi.mocked(investmentRepository.listSecurityPrices).mockImplementation(async(_id,_from,to)=>to==="2026-01-15"?[]:[{id:"future",securityId:"sec",observedAt:"2026-02-01",priceE8:200_000_000,currency:"USD",source:"manual"}]);
  render(<PortfolioPage accounts={accounts} focus={{accountId:"inv",securityId:"sec"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);await screen.findByText("Security detail");fireEvent.click(screen.getByRole("button",{name:"Choose date"}));fireEvent.change(screen.getByLabelText("Historical as of date"),{target:{value:"2026-01-15"}});
  await screen.findByText("Price needed");expect(screen.getByText("No saved observations through this date.")).toBeTruthy();expect(screen.queryByText(/Feb 1, 2026/)).toBeNull();
 });
 it("shows saved price source/date and local chart observations",async()=>{
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValue(snapshot);vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([]);vi.mocked(investmentRepository.listSecurityPrices).mockResolvedValue([{id:"p1",securityId:"sec",observedAt:"2026-09-10",priceE8:110_000_000,currency:"USD",source:"manual"},{id:"p2",securityId:"sec",observedAt:"2026-09-20",priceE8:125_000_000,currency:"USD",source:"manual"}]);
  render(<PortfolioPage accounts={accounts} focus={{accountId:"inv",securityId:"sec"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);expect(await screen.findByRole("img",{name:"Local price history chart"})).toBeTruthy();expect(screen.getByText(/Selected observation:/)).toBeTruthy();expect(screen.getAllByText(/Sep 20, 2026 · Manual/).length).toBeGreaterThanOrEqual(1);expect(screen.getByText(/older than selected as-of date/)).toBeTruthy();
 });
 it("retains the selected as-of date when drilling from account holdings into security detail",async()=>{
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockImplementation(async(_ids,date)=>({...snapshot,asOfDate:date}));vi.mocked(investmentRepository.listSecurities).mockResolvedValue([security]);vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([]);const open=vi.fn();
  const view=render(<PortfolioPage accounts={accounts} focus={{accountId:"inv"}} onShowAll={()=>{}} onOpenSecurity={open}/>);await screen.findByText("Account value");fireEvent.click(screen.getByRole("button",{name:"Choose date"}));fireEvent.change(screen.getByLabelText("Historical as of date"),{target:{value:"2026-01-15"}});await vi.waitFor(()=>expect(investmentRepository.calculatePortfolioSnapshot).toHaveBeenCalledWith(["inv"],"2026-01-15"));fireEvent.click(screen.getByRole("button",{name:/EXM/}));expect(open).toHaveBeenCalledWith("inv","sec");view.rerender(<PortfolioPage accounts={accounts} focus={{accountId:"inv",securityId:"sec"}} onShowAll={()=>{}} onOpenSecurity={open}/>);await vi.waitFor(()=>expect((screen.getByLabelText("Historical as of date") as HTMLInputElement).value).toBe("2026-01-15"));
 });
 it("normalizes nullable native price provenance",()=>{expect(normalizeSecurityPrice({id:"p",securityId:"sec",observedAt:"2026-01-01",priceE8:100_000_000,currency:"USD",source:"manual",provenance:null}).provenance).toBeUndefined();});
 it("normalizes native null activity fields to undefined",()=>{
  const normalized=normalizeInvestmentEvent({...buy,supersedesRevisionId:null,settlementDate:null,acquisitionDate:null,relatedAccountId:null,unitPriceE8:null,memo:null,externalId:null,provenance:null,groupId:null,correctionReason:null,securityId:null,quantityE8:null,grossCashMinor:null});
  expect(normalized.securityId).toBeUndefined();expect(normalized.quantityE8).toBeUndefined();expect(normalized.grossCashMinor).toBeUndefined();expect(normalized.acquisitionDate).toBeUndefined();expect(normalized.provenance).toBeUndefined();
 });
});


describe("manual investment entry refresh",()=>{
 it("refreshes Portfolio projections immediately after activity is saved",async()=>{
  const empty:PortfolioSnapshot={asOfDate:"2026-09-22",accounts:[{accountId:"inv",cashMinor:0,holdingsValueMinor:0,totalValueMinor:0,holdings:[]}]};
  const after:PortfolioSnapshot={asOfDate:"2026-09-22",accounts:[{accountId:"inv",cashMinor:0,holdingsValueMinor:undefined,totalValueMinor:undefined,holdings:[{accountId:"inv",securityId:"sec",quantityE8:100_000_000,knownBasisMinor:10000,unknownBasisQuantityE8:0,incompleteUnknownBasis:false,lots:[{acquisitionEventId:"e1",acquisitionDate:"2020-01-01",quantityE8:100_000_000,basisMinor:10000}],realized:{knownBasisQuantityE8:0,knownDisposedBasisMinor:0,calculableProceedsMinor:0,calculableGainMinor:0,unknownBasisQuantityE8:0,unknownBasisProceedsMinor:0,incompleteUnknownBasis:false}}]}]};
  const sec={id:"sec",securityType:"stock" as const,name:"Example Corp",symbol:"EXM",currency:"USD",archived:false};
  vi.mocked(investmentRepository.calculatePortfolioSnapshot).mockResolvedValueOnce(empty).mockResolvedValue(after);
  vi.mocked(investmentRepository.listSecurities).mockResolvedValue([sec]);
  vi.mocked(investmentRepository.listInvestmentEvents).mockResolvedValue([]);
  vi.mocked(investmentRepository.createInvestmentEvent).mockImplementation(async input=>({...input,id:"r1",eventId:"e1",revisionNumber:1}));
  const view=render(<PortfolioPage accounts={accounts} focus={{accountId:"inv"}} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);
  await screen.findByText("Account value");
  fireEvent.click(screen.getByRole("button",{name:"+ Add activity"}));
  const dialog=screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Activity"),{target:{value:"opening_position"}});
  fireEvent.change(dialog.querySelector('[name="quantity"]')!,{target:{value:"1"}});
  fireEvent.change(dialog.querySelector('[name="basis"]')!,{target:{value:"100.00"}});
  fireEvent.change(dialog.querySelector('[name="acquisitionDate"]')!,{target:{value:"2020-01-01"}});
  fireEvent.submit(within(dialog).getByRole("button",{name:"Add activity"}).closest("form")!);
  await vi.waitFor(()=>expect(investmentRepository.calculatePortfolioSnapshot).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("EXM")).toBeTruthy();
  view.unmount();
 });
});
