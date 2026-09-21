// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Account } from "./domain";

vi.mock("./repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository")>();
  return { ...actual, isNativeApp:true, investmentRepository:{ ...actual.investmentRepository, calculatePortfolioSnapshot:vi.fn(), listSecurities:vi.fn(), listInvestmentEvents:vi.fn() } };
});

import { PortfolioPage } from "./PortfolioPage";
import { investmentRepository, normalizeInvestmentEvent, normalizePortfolioSnapshot } from "./repository";

afterEach(()=>{cleanup();vi.clearAllMocks();});

const accounts:Account[]=[
  {id:"inv",name:"Household Brokerage",type:"investment",currency:"USD",balanceMinor:0,ownerLabel:"Household",archived:false},
];

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

    const row=(await screen.findByText("EXM")).closest("tr") as HTMLTableRowElement|null;
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
 const snapshot={asOfDate:"2026-09-21",accounts:[{accountId:"inv",cashMinor:5000,holdingsValueMinor:12500,totalValueMinor:17500,holdings:[{accountId:"inv",securityId:"sec",quantityE8:100_000_000,knownBasisMinor:10000,unknownBasisQuantityE8:0,priceE8:125_000_000,priceObservedAt:"2026-09-20",marketValueMinor:12500,unrealizedGainMinor:2500,incompleteUnknownBasis:false,lots:[{acquisitionEventId:"buy",acquisitionDate:"2026-01-02",quantityE8:100_000_000,basisMinor:10000}],realized:{knownBasisQuantityE8:0,knownDisposedBasisMinor:0,calculableProceedsMinor:0,calculableGainMinor:0,unknownBasisQuantityE8:0,unknownBasisProceedsMinor:0,incompleteUnknownBasis:false}}]}]};
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
  expect(screen.getByText("Cash held in this investment account")).toBeTruthy();expect(screen.getByText("$50.00")).toBeTruthy();expect(screen.getByText("Income $5.00")).toBeTruthy();
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
  expect(await screen.findByText("Price needed")).toBeTruthy();expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);expect(screen.getByText(/Partial — some basis is unknown/)).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:/Lots/}));expect(screen.getByText("Unknown acquisition date")).toBeTruthy();expect(screen.getByText("Unknown basis")).toBeTruthy();
 });
 it("normalizes native null activity fields to undefined",()=>{
  const normalized=normalizeInvestmentEvent({...buy,supersedesRevisionId:null,settlementDate:null,acquisitionDate:null,relatedAccountId:null,unitPriceE8:null,memo:null,externalId:null,provenance:null,groupId:null,correctionReason:null,securityId:null,quantityE8:null,grossCashMinor:null});
  expect(normalized.securityId).toBeUndefined();expect(normalized.quantityE8).toBeUndefined();expect(normalized.grossCashMinor).toBeUndefined();expect(normalized.acquisitionDate).toBeUndefined();expect(normalized.provenance).toBeUndefined();
 });
});
