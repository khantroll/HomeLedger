import {describe,expect,it} from "vitest";
import {
  assertDisclosurePolicy,
  assertTransmissionAllowed,
  cloudProviderDescriptor,
  disclosureAllowedForTrust,
  localProviderDescriptor,
  providerAdapterContract,
  validateProviderEndpoint
} from "./aiProvider";
import {buildAiFirewallPreview,buildAiTaskFirewallPreview,prepareReviewedTransmission,validateLocalAiProvider} from "./aiPrivacy";
import {buildAffordabilityAnalysisContext} from "./aiTaskContext";
import type {Account,Transaction} from "./domain";

const accounts:Account[]=[{id:"checking-private",name:"Jeffrey Household Checking",type:"checking",currency:"USD",balanceMinor:100000,ownerLabel:"Jeffrey"}];
const transactions:Transaction[]=[
  {id:"provider-id-1",accountId:"checking-private",postedDate:"2026-09-18",payee:"Neighborhood Market",category:"Food: Groceries",amountMinor:-1234,status:"cleared",externalId:"bank-secret",memo:"private memo",source:"import"},
  {id:"provider-id-2",accountId:"checking-private",postedDate:"2026-09-19",payee:"Private Clinic",category:"Medical",amountMinor:-2525,status:"cleared"}
];
const local={kind:"ollama" as const,endpoint:"http://127.0.0.1:11434/v1",model:"qwen3.5:9b"};

describe("AI provider trust and Privacy Firewall",()=>{
  it("keeps local-provider behavior from the localhost adapter intact",()=>{
    expect(validateLocalAiProvider(local).endpoint).toBe("http://127.0.0.1:11434/v1");
    const preview=buildAiFirewallPreview({provider:local,purpose:"Explain household cash flow",mode:"aggregate",accounts,transactions});
    expect(preview.verifiedLocalhost).toBe(true);
    expect(preview.trust).toBe("local");
    expect(preview.transmissionEnabled).toBe(true);
    expect(preview.payload).toContain('"spendingMinor": 3759');
    prepareReviewedTransmission(localProviderDescriptor(validateLocalAiProvider(local)),preview);
  });

  it("applies disclosure policy before provider invocation and blocks full-local on cloud",()=>{
    const cloud=validateProviderEndpoint(cloudProviderDescriptor({
      type:"openai",
      endpoint:"https://api.openai.com/v1",
      model:"gpt-4.1-mini",
      accountId:"cloud:openai:default"
    }));
    expect(disclosureAllowedForTrust("cloud","full-local")).toBe(false);
    expect(()=>assertDisclosurePolicy(cloud,"full-local")).toThrow(/Full Local Context|does not permit/i);
    assertTransmissionAllowed(cloud);
    const task=buildAffordabilityAnalysisContext({
      question:"Can I afford another $50 per month?",
      currency:"USD",
      proposedMonthlyCostMinor:5_000,
      asOfDate:"2026-09-20",
      accounts,
      transactions,
      templates:[],
      occurrences:[],
      budgets:[]
    });
    const preview=buildAiTaskFirewallPreview({provider:cloud,taskContext:task});
    expect(preview.transmissionEnabled).toBe(true);
    expect(preview.payload).toContain('"task": "affordability-analysis"');
    expect(()=>prepareReviewedTransmission(cloud,preview)).toThrow(/confirmation/i);
  });

  it("fails closed for unsupported or untrusted remote endpoints",()=>{
    expect(()=>validateProviderEndpoint(cloudProviderDescriptor({
      type:"openai-compatible-remote",
      endpoint:"https://evil.example/v1",
      model:"x",
      accountId:"cloud:custom"
    }))).toThrow(/not approved|Unapproved|Arbitrary/i);
    expect(()=>validateProviderEndpoint(cloudProviderDescriptor({
      type:"openai",
      endpoint:"http://api.openai.com/v1",
      model:"x",
      accountId:"cloud:openai:default"
    }))).toThrow(/HTTPS/);
    expect(()=>validateProviderEndpoint(cloudProviderDescriptor({
      type:"openai",
      endpoint:"https://api.openai.com.evil/v1",
      model:"x",
      accountId:"cloud:openai:default"
    }))).toThrow(/Unapproved/);
    expect(()=>validateProviderEndpoint(cloudProviderDescriptor({
      type:"anthropic",
      endpoint:"https://api.anthropic.com/v1",
      model:"claude-sonnet-4-5",
      accountId:"cloud:anthropic:default"
    }))).toThrow(/API root/i);
    expect(()=>validateProviderEndpoint(cloudProviderDescriptor({
      type:"anthropic",
      endpoint:"http://api.anthropic.com",
      model:"claude-sonnet-4-5",
      accountId:"cloud:anthropic:default"
    }))).toThrow(/HTTPS/);
    expect(()=>assertTransmissionAllowed(cloudProviderDescriptor({
      type:"gemini",
      endpoint:"https://generativelanguage.googleapis.com/v1beta",
      model:"gemini-2.0-flash",
      accountId:"cloud:gemini:default"
    }))).not.toThrow();
    expect(()=>assertTransmissionAllowed(cloudProviderDescriptor({
      type:"mistral",
      endpoint:"https://api.mistral.ai/v1",
      model:"mistral-small",
      accountId:"cloud:mistral:default"
    }))).toThrow(/not enabled/i);
    expect(()=>validateProviderEndpoint(cloudProviderDescriptor({
      type:"gemini",
      endpoint:"https://generativelanguage.googleapis.com/v1",
      model:"gemini-2.0-flash",
      accountId:"cloud:gemini:default"
    }))).toThrow(/v1beta/i);
    expect(()=>validateLocalAiProvider({...local,endpoint:"http://api.example.com/v1"})).toThrow(/loopback|localhost/i);
  });

  it("documents that provider adapters never receive repository access or mutation rights",()=>{
    const contract=providerAdapterContract();
    expect(contract.mayAccessRepository).toBe(false);
    expect(contract.mayMutateLedger).toBe(false);
    expect(contract.receivesOnlyReviewedPayload).toBe(true);
  });
});
