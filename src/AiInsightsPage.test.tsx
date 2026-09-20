// @vitest-environment jsdom
import {afterEach,describe,expect,it} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {AiInsightsPage} from "./AiInsightsPage";
import type {Account,Transaction} from "./domain";

afterEach(cleanup);
const accounts:Account[]=[{id:"checking",name:"Household Checking",type:"checking",currency:"USD",balanceMinor:0,ownerLabel:"Household"}];
const transactions:Transaction[]=[{id:"t1",accountId:"checking",postedDate:"2026-09-18",payee:"Neighborhood Market",category:"Food",amountMinor:-1234,status:"cleared"}];

describe("AI Insights privacy review",()=>{
  it("builds a localhost aggregate preview without offering transmission",async()=>{
    const user=userEvent.setup();render(<AiInsightsPage accounts={accounts} transactions={transactions}/>);
    expect(screen.getByText(/Only the payload shown by the Privacy Firewall can be sent/i)).toBeTruthy();
    await user.type(screen.getByLabelText("Model name"),"qwen3.5:9b");await user.type(screen.getByLabelText(/Analysis purpose/),"Explain spending");await user.click(screen.getByRole("button",{name:/Build exact preview/}));
    expect(screen.getByText("http://127.0.0.1:11434/v1")).toBeTruthy();expect(screen.getAllByText("Aggregate Only").length).toBeGreaterThan(1);expect((screen.getByRole("button",{name:/Send reviewed payload/}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(/"spendingMinor": 1234/)).toBeTruthy();expect(screen.queryByText(/Neighborhood Market/)).toBeNull();
  });
  it("rejects a remote endpoint before constructing a payload",async()=>{
    const user=userEvent.setup();render(<AiInsightsPage accounts={accounts} transactions={transactions}/>);await user.selectOptions(screen.getByLabelText("Provider"),"openai-compatible-local");const endpoint=screen.getByLabelText(/Local endpoint/);await user.clear(endpoint);await user.type(endpoint,"http://api.example.com/v1");await user.type(screen.getByLabelText("Model name"),"remote");await user.type(screen.getByLabelText(/Analysis purpose/),"No disclosure");await user.click(screen.getByRole("button",{name:/Build exact preview/}));expect(screen.getByRole("alert").textContent).toMatch(/localhost/);expect(screen.getByText("No payload constructed")).toBeTruthy();
  });
});
