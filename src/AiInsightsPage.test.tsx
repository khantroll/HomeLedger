// @vitest-environment jsdom
import {afterEach,describe,expect,it} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {AiInsightsPage} from "./AiInsightsPage";
import type {Account,BudgetMonth,ScheduledOccurrence,ScheduledTransaction,Transaction} from "./domain";

afterEach(cleanup);
const accounts:Account[]=[{id:"checking",name:"Household Checking",type:"checking",currency:"USD",balanceMinor:100000,ownerLabel:"Household"}];
const transactions:Transaction[]=[
  {id:"t1",accountId:"checking",postedDate:"2026-09-18",payee:"Neighborhood Market",category:"Food",amountMinor:-1234,status:"cleared"},
  {id:"t2",accountId:"checking",postedDate:"2026-08-18",payee:"Payroll",category:"Income",amountMinor:300000,status:"cleared"}
];
const templates:ScheduledTransaction[]=[];
const occurrences:ScheduledOccurrence[]=[];
const budgets:BudgetMonth[]=[];

describe("AI Insights privacy review",()=>{
  it("builds a localhost aggregate preview without offering browser transmission",async()=>{
    const user=userEvent.setup();
    render(<AiInsightsPage accounts={accounts} transactions={transactions} templates={templates} occurrences={occurrences} budgets={budgets}/>);
    expect(screen.getByText(/Local loopback and enabled cloud adapters/i)).toBeTruthy();
    await user.click(screen.getByText(/Custom \/ ad-hoc question/i));
    await user.type(screen.getByLabelText("Model name",{exact:true}),"qwen3.5:9b");
    await user.clear(screen.getByLabelText(/Analysis purpose/));
    await user.type(screen.getByLabelText(/Analysis purpose/),"Explain spending");
    await user.click(screen.getByRole("button",{name:/Build exact preview/}));
    expect(screen.getByText("http://127.0.0.1:11434/v1")).toBeTruthy();
    expect(screen.getAllByText("Aggregate Only").length).toBeGreaterThan(1);
    expect((screen.getByRole("button",{name:/Send reviewed payload to local model/}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/"spendingMinor": 1234/)).toBeTruthy();
    expect(screen.queryByText(/Neighborhood Market/)).toBeNull();
  });

  it("builds an affordability task preview without prohibited identity fields",async()=>{
    const user=userEvent.setup();
    render(<AiInsightsPage accounts={accounts} transactions={transactions} templates={templates} occurrences={occurrences} budgets={budgets} today="2026-09-20"/>);
    await user.type(screen.getByLabelText("Model name",{exact:true}),"qwen3.5:9b");
    await user.click(screen.getByRole("button",{name:/Build exact preview/}));
    expect(screen.getByText(/Task-specific Affordability Analysis/)).toBeTruthy();
    expect(screen.getByText(/"task": "affordability-analysis"/)).toBeTruthy();
    expect(screen.getByText(/"proposedMonthlyCostMinor": 5000/)).toBeTruthy();
    expect(screen.queryByText(/Household Checking/)).toBeNull();
    expect(screen.queryByText(/Neighborhood Market/)).toBeNull();
    expect(screen.getByText(/Cloud provider configuration/)).toBeTruthy();
  });

  it("requires cloud confirmation before enabling OpenAI or Anthropic send",async()=>{
    const user=userEvent.setup();
    render(<AiInsightsPage accounts={accounts} transactions={transactions} templates={templates} occurrences={occurrences} budgets={budgets} today="2026-09-20"/>);
    await user.click(screen.getByRole("button",{name:/Preview affordability for OpenAI/}));
    expect(screen.getByText(/Destination is OpenAI \(cloud\)/i)).toBeTruthy();
    expect(screen.getByText(/"task": "affordability-analysis"/)).toBeTruthy();
    const send=screen.getByRole("button",{name:/Send reviewed payload to OpenAI/}) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.click(screen.getByLabelText(/confirm sending it to OpenAI/i));
    expect(send.disabled).toBe(true);
    expect(screen.getByText(/will leave this device/i)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Cloud provider"),"anthropic");
    await user.click(screen.getByRole("button",{name:/Preview affordability for Anthropic/}));
    expect(screen.getByText(/Destination is Anthropic \(cloud\)/i)).toBeTruthy();
    expect(screen.getByText(/"task": "affordability-analysis"/)).toBeTruthy();
    expect((screen.getByRole("button",{name:/Send reviewed payload to Anthropic/}) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects a remote endpoint before constructing a payload",async()=>{
    const user=userEvent.setup();
    render(<AiInsightsPage accounts={accounts} transactions={transactions} templates={templates} occurrences={occurrences} budgets={budgets}/>);
    await user.click(screen.getByText(/Custom \/ ad-hoc question/i));
    await user.selectOptions(screen.getByLabelText("Provider"),"openai-compatible-local");
    const endpoint=screen.getByLabelText(/Local endpoint/);
    await user.clear(endpoint);
    await user.type(endpoint,"http://api.example.com/v1");
    await user.type(screen.getByLabelText("Model name",{exact:true}),"remote");
    await user.clear(screen.getByLabelText(/Analysis purpose/));
    await user.type(screen.getByLabelText(/Analysis purpose/),"No disclosure");
    await user.click(screen.getByRole("button",{name:/Build exact preview/}));
    expect(screen.getByRole("alert").textContent).toMatch(/loopback|localhost/i);
    expect(screen.getByText("No payload constructed")).toBeTruthy();
  });
});
