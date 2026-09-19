// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {BudgetPage} from "./BudgetPage";
import {financeRepository} from "./repository";

const month={month:"2026-09",plannedMinor:30000,spentMinor:12500,carryInMinor:5000,availableMinor:22500,lines:[{id:"food",category:"Food: Groceries",rolloverEnabled:true,plannedMinor:30000,spentMinor:12500,carryInMinor:5000,availableMinor:22500}]};

afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe("BudgetPage",()=>{
  it("shows planned, spent, rollover, and available amounts and saves allocation changes",async()=>{
    const user=userEvent.setup();
    vi.spyOn(financeRepository,"getBudgetMonth").mockResolvedValue(month);
    const save=vi.spyOn(financeRepository,"setBudgetAllocation").mockResolvedValue();
    render(<BudgetPage transactions={[]}/>);
    expect(await screen.findByText("Food: Groceries")).toBeTruthy();
    expect(screen.getAllByText("$225.00").length).toBeGreaterThan(0);
    const input=screen.getByLabelText("Planned amount for Food: Groceries");await user.clear(input);await user.type(input,"400.00");await user.click(screen.getByRole("button",{name:"Save"}));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({budgetCategoryId:"food",plannedMinor:40000}));
  });

  it("creates a rollover category from the monthly budget",async()=>{
    const user=userEvent.setup();
    vi.spyOn(financeRepository,"getBudgetMonth").mockResolvedValue({...month,lines:[]});
    const create=vi.spyOn(financeRepository,"createBudgetCategory").mockResolvedValue({id:"repairs",category:"Home: Repairs",rolloverEnabled:true});
    const allocate=vi.spyOn(financeRepository,"setBudgetAllocation").mockResolvedValue();
    render(<BudgetPage transactions={[]}/>);await waitFor(()=>expect(screen.getByText("No budget categories yet.")).toBeTruthy());
    await user.click(screen.getByRole("button",{name:/Add category/}));await user.type(screen.getByLabelText("Category"),"Home: Repairs");await user.clear(screen.getByLabelText(/Planned for/));await user.type(screen.getByLabelText(/Planned for/),"100.00");await user.click(screen.getByLabelText(/Carry unused funds/));await user.click(screen.getAllByRole("button",{name:"Add category"}).at(-1)!);
    expect(create).toHaveBeenCalledWith({category:"Home: Repairs",rolloverEnabled:true});
    expect(allocate).toHaveBeenCalledWith(expect.objectContaining({budgetCategoryId:"repairs",plannedMinor:10000}));
  });
});
