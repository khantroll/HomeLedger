import {describe,expect,it} from "vitest";
import type {Account,Transaction} from "./domain";
import {buildAiFirewallPreview,validateLocalAiProvider} from "./aiPrivacy";

const accounts:Account[]=[{id:"checking-private",name:"Jeffrey Household Checking",type:"checking",currency:"USD",balanceMinor:100000,ownerLabel:"Jeffrey"}];
const transactions:Transaction[]=[
  {id:"provider-id-1",accountId:"checking-private",postedDate:"2026-09-18",payee:"Neighborhood Market",category:"Food: Groceries",amountMinor:-1234,status:"cleared",externalId:"bank-secret",memo:"private memo",source:"import"},
  {id:"provider-id-2",accountId:"checking-private",postedDate:"2026-09-19",payee:"Private Clinic",category:"Medical",amountMinor:-2525,status:"cleared"}
];
const provider={kind:"ollama" as const,endpoint:"http://127.0.0.1:11434/v1",model:"qwen3.5:9b"};

describe("AI Privacy Firewall",()=>{
  it("accepts loopback providers and rejects remote or credential-bearing destinations",()=>{
    expect(validateLocalAiProvider(provider).endpoint).toBe("http://127.0.0.1:11434/v1");
    expect(()=>validateLocalAiProvider({...provider,endpoint:"https://localhost:11434/v1"})).toThrow(/HTTP/);
    expect(()=>validateLocalAiProvider({...provider,endpoint:"http://api.example.com/v1"})).toThrow(/localhost/);
    expect(()=>validateLocalAiProvider({...provider,endpoint:"http://key@localhost:11434/v1"})).toThrow(/credentials/);
  });
  it("builds aggregate-only cloud-safe data without ledger identifiers or descriptions",()=>{
    const preview=buildAiFirewallPreview({provider,purpose:"Explain household cash flow",mode:"aggregate",accounts,transactions});
    expect(preview.verifiedLocalhost).toBe(true);expect(preview.recordCount).toBe(2);expect(preview.excludedSensitiveCategories).toBe(1);
    expect(preview.payload).toContain('"spendingMinor": 3759');
    for(const secret of ["Jeffrey","checking-private","Neighborhood Market","Private Clinic","Medical","bank-secret","private memo","provider-id-1"])expect(preview.payload).not.toContain(secret);
  });
  it("uses stable aliases, month dates, amount bands, and removes sensitive categories",()=>{
    const first=buildAiFirewallPreview({provider,purpose:"Find patterns",mode:"redacted",accounts,transactions}),second=buildAiFirewallPreview({provider,purpose:"Find patterns",mode:"redacted",accounts,transactions});
    expect(first.payload).toBe(second.payload);expect(first.payload).toContain('"month": "2026-09"');expect(first.payload).toContain('"amountBandMinor": -1000');expect(first.payload).toContain("Removed-sensitive");
    expect(first.payload).not.toContain("Neighborhood Market");expect(first.payload).not.toContain("2026-09-18");
  });
  it("requires custom fields and confines full context to verified localhost",()=>{
    expect(()=>buildAiFirewallPreview({provider,purpose:"Custom",mode:"custom",accounts,transactions,customFields:[]})).toThrow(/one custom/);
    const full=buildAiFirewallPreview({provider,purpose:"Local detail",mode:"full-local",accounts,transactions});expect(full.payload).toContain("Neighborhood Market");expect(full.payload).not.toContain("bank-secret");
    expect(()=>buildAiFirewallPreview({provider:{...provider,endpoint:"http://api.openai.com/v1"},purpose:"No",mode:"full-local",accounts,transactions})).toThrow(/localhost/);
  });
});
