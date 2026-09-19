// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {SavingsGoals} from "./SavingsGoals";
import {financeRepository} from "./repository";
import type {Account,SavingsGoal} from "./domain";

const savings:Account={id:"savings",name:"Emergency Savings",type:"savings",currency:"USD",balanceMinor:250000,ownerLabel:"Household"};
const goal:SavingsGoal={id:"goal",name:"Emergency fund",accountId:"savings",targetMinor:1000000,targetDate:"2027-09-19",plannedMonthlyMinor:75000};

afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe("SavingsGoals",()=>{
  it("shows ledger-derived progress and supports reviewed edits and deletion",async()=>{
    const user=userEvent.setup();vi.spyOn(financeRepository,"listSavingsGoals").mockResolvedValue([goal]);
    const update=vi.spyOn(financeRepository,"updateSavingsGoal").mockImplementation(async(id,input)=>({id,...input}));const remove=vi.spyOn(financeRepository,"deleteSavingsGoal").mockResolvedValue();
    render(<SavingsGoals accounts={[savings]} asOfDate="2026-09-19"/>);
    expect(await screen.findByText("Emergency fund")).toBeTruthy();expect(screen.getByText("On track")).toBeTruthy();expect(screen.getByText("$625.00")).toBeTruthy();
    await user.click(screen.getByRole("button",{name:"Edit"}));const planned=screen.getByLabelText(/Planned monthly contribution/);await user.clear(planned);await user.type(planned,"800.00");await user.click(screen.getByRole("button",{name:"Save goal"}));expect(update).toHaveBeenCalledWith("goal",expect.objectContaining({plannedMonthlyMinor:80000}));
    await user.click(screen.getByRole("button",{name:"Delete Emergency fund"}));await user.click(screen.getByRole("button",{name:"Confirm delete"}));expect(remove).toHaveBeenCalledWith("goal");
  });
  it("creates a goal only after explicit form submission",async()=>{
    const user=userEvent.setup();vi.spyOn(financeRepository,"listSavingsGoals").mockResolvedValue([]);const create=vi.spyOn(financeRepository,"createSavingsGoal").mockImplementation(async input=>({id:"new",...input}));
    render(<SavingsGoals accounts={[savings]} asOfDate="2026-09-19"/>);expect(await screen.findByText("No savings goals yet.")).toBeTruthy();await user.click(screen.getByRole("button",{name:/Add goal/}));await user.type(screen.getByLabelText("Goal name"),"New roof");await user.type(screen.getByLabelText("Target amount"),"12000.00");await user.type(screen.getByLabelText("Target date"),"2027-09-19");const planned=screen.getByLabelText(/Planned monthly contribution/);await user.clear(planned);await user.type(planned,"800.00");await user.click(screen.getByRole("button",{name:"Save goal"}));expect(create).toHaveBeenCalledWith({name:"New roof",accountId:"savings",targetMinor:1200000,targetDate:"2027-09-19",plannedMonthlyMinor:80000});
  });
});
