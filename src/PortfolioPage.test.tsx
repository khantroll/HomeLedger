// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Account } from "./domain";

vi.mock("./repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository")>();
  return { ...actual, isNativeApp:true, investmentRepository:{ ...actual.investmentRepository, calculatePortfolioSnapshot:vi.fn(), listSecurities:vi.fn() } };
});

import { PortfolioPage } from "./PortfolioPage";
import { investmentRepository, normalizePortfolioSnapshot } from "./repository";

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

    render(<PortfolioPage accounts={accounts} onShowAll={()=>{}} onOpenSecurity={()=>{}}/>);

    const row=(await screen.findByText("EXM")).closest("tr") as HTMLTableRowElement|null;
    expect(row).toBeTruthy();
    if(!row)throw new Error("Holding row was not rendered");
    expect(within(row).getByText("Price needed")).toBeTruthy();
    expect(within(row).getAllByText("Unknown").length).toBeGreaterThanOrEqual(3);
    expect(within(row).queryByText("$0.00")).toBeNull();

    const investments=screen.getByText("Investments").closest(".summary");
    const portfolioValue=screen.getByText("Portfolio value").closest(".summary");
    expect(investments&&within(investments).getByText("Unknown")).toBeTruthy();
    expect(portfolioValue&&within(portfolioValue).getByText("Unknown")).toBeTruthy();

    const weightCell=within(row).getAllByRole("cell")[7];
    expect(within(weightCell).getByText("Unknown")).toBeTruthy();
  });
});
