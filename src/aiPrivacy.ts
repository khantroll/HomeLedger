import type {Account,Transaction} from "./domain";
import {
  assertDisclosurePolicy,
  assertTransmissionAllowed,
  localProviderDescriptor,
  type AiProviderDescriptor,
  validateProviderEndpoint
} from "./aiProvider";
import type {AiTaskContext} from "./aiTaskContext";
import {serializeAiTaskContext} from "./aiTaskContext";

export type LocalAiProviderKind="ollama"|"lm-studio"|"openai-compatible-local";
export type AiDisclosureMode="aggregate"|"redacted"|"custom"|"full-local";
export type CustomDisclosureField="accountType"|"month"|"amountBand"|"merchantAlias"|"categoryAlias";
export type AiAnalysisMode="task"|"adhoc";

export interface LocalAiProviderConfig{kind:LocalAiProviderKind;endpoint:string;model:string;}
export interface AiFirewallInput{
  provider:LocalAiProviderConfig;
  purpose:string;
  mode:AiDisclosureMode;
  accounts:readonly Account[];
  transactions:readonly Transaction[];
  customFields?:readonly CustomDisclosureField[];
}
export interface AiFirewallPreview{
  destination:string;
  providerLabel:string;
  modeLabel:string;
  trust:AiProviderDescriptor["trust"];
  verifiedLocalhost:boolean;
  transmissionEnabled:boolean;
  payload:string;
  recordCount:number;
  excludedSensitiveCategories:number;
  notices:string[];
  analysisMode:AiAnalysisMode;
  taskKind?:string;
}

const SENSITIVE_CATEGORY=/(?:health|medical|therapy|counsel|relig|legal|gambl|adult|substance|disability)/i;

export const LOCAL_PROVIDER_PRESETS:Record<Exclude<LocalAiProviderKind,"openai-compatible-local">,{label:string;endpoint:string}>={
  ollama:{label:"Ollama",endpoint:"http://127.0.0.1:11434/v1"},
  "lm-studio":{label:"LM Studio",endpoint:"http://127.0.0.1:1234/v1"}
};

export function validateLocalAiProvider(provider:LocalAiProviderConfig):LocalAiProviderConfig{
  const model=provider.model.trim();if(!model)throw new Error("Choose or enter a local model name");
  const descriptor=validateProviderEndpoint(localProviderDescriptor({...provider,model}));
  return{kind:provider.kind,endpoint:descriptor.endpoint,model:descriptor.model};
}

export function buildAiFirewallPreview(input:AiFirewallInput):AiFirewallPreview{
  const provider=validateLocalAiProvider(input.provider),purpose=input.purpose.trim();
  if(!purpose)throw new Error("Describe the question or analysis purpose before building a payload");
  const descriptor=localProviderDescriptor(provider);
  assertDisclosurePolicy(descriptor,input.mode);
  const accountMap=new Map(input.accounts.map(account=>[account.id,account]));
  const transactions=input.transactions.filter(item=>accountMap.has(item.accountId)&&!item.transferLinkId&&item.source!=="transfer"&&item.source!=="adjustment");
  const sensitiveCount=transactions.filter(item=>SENSITIVE_CATEGORY.test(item.category)).length;
  let data:unknown,recordCount=transactions.length;
  if(input.mode==="aggregate")data=aggregateData(input.accounts,transactions);
  else if(input.mode==="redacted")data=transactions.map(item=>redactedTransaction(item,accountMap.get(item.accountId)!));
  else if(input.mode==="custom"){
    const fields=new Set(input.customFields??[]);if(!fields.size)throw new Error("Select at least one custom disclosure field");
    data=transactions.map(item=>customTransaction(item,accountMap.get(item.accountId)!,fields));
  }else data=transactions.map(item=>fullLocalTransaction(item,accountMap.get(item.accountId)!));
  const envelope={model:provider.model,purpose,disclosureMode:input.mode,analysisMode:"adhoc" as const,data};
  return finalizePreview({
    provider:descriptor,
    modeLabel:modeLabel(input.mode),
    payload:JSON.stringify(envelope,null,2),
    recordCount,
    excludedSensitiveCategories:input.mode==="full-local"?0:sensitiveCount,
    analysisMode:"adhoc",
    disclosureNotice:input.mode==="full-local"?"Full local context includes ledger descriptions and is restricted to this verified localhost destination.":input.mode==="aggregate"?"Only aggregate totals, counts, currencies, and a month range are included.":input.mode==="redacted"?"Transaction dates use months, amounts use $10 bands, and names use stable aliases.":"Only the selected minimized fields are included."
  });
}

export function buildAiTaskFirewallPreview(input:{
  provider:AiProviderDescriptor;
  taskContext:AiTaskContext;
}):AiFirewallPreview{
  const provider=validateProviderEndpoint(input.provider);
  if(!provider.allowsTaskContexts)throw new Error(`${provider.label} does not permit task-specific contexts`);
  if(provider.trust!=="local"){
    if(provider.allowsFullLocalContext)throw new Error("Full local capability cannot be enabled for non-local providers");
  }
  const leavesDevice=provider.trust!=="local";
  const modeLabel=input.taskContext.task==="spending-change-analysis"
    ?"Task-specific Spending Change Analysis"
    :input.taskContext.task==="budget-review-analysis"
      ?"Task-specific Budget Review"
      :input.taskContext.task==="debt-strategy-analysis"
        ?"Task-specific Debt Strategy"
        :"Task-specific Affordability Analysis";
  const taskPayload={
    model:provider.model,
    purpose:input.taskContext.question,
    disclosureMode:"task-specific",
    analysisMode:"task" as const,
    task:input.taskContext.task,
    schemaVersion:input.taskContext.schemaVersion,
    data:input.taskContext
  };
  return finalizePreview({
    provider,
    modeLabel,
    payload:JSON.stringify(taskPayload,null,2),
    recordCount:0,
    excludedSensitiveCategories:0,
    analysisMode:"task",
    taskKind:input.taskContext.task,
    disclosureNotice:leavesDevice
      ?"Task-specific context uses deterministic HomeLedger aggregates. Sending this payload transmits sanitized financial facts to a cloud provider and leaves this device."
      :"Task-specific context uses deterministic HomeLedger aggregates and excludes account names, payees, memos, IDs, and import provenance."
  });
}

export function prepareReviewedTransmission(
  provider:AiProviderDescriptor,
  preview:AiFirewallPreview,
  options:{explicitConfirmation?:boolean}={}
):{endpoint:string;model:string;payload:string;accountId:string;trust:AiProviderDescriptor["trust"];type:AiProviderDescriptor["type"];providerLabel:string}{
  assertTransmissionAllowed(provider);
  if(preview.destination!==provider.endpoint)throw new Error("Reviewed destination no longer matches the selected provider");
  if(!preview.transmissionEnabled)throw new Error("This provider is not enabled for transmission");
  if(provider.trust==="cloud"&&!options.explicitConfirmation){
    throw new Error("Cloud transmission requires explicit per-request confirmation");
  }
  return{
    endpoint:preview.destination,
    model:provider.model,
    payload:preview.payload,
    accountId:provider.accountId,
    trust:provider.trust,
    type:provider.type,
    providerLabel:provider.label
  };
}

function finalizePreview(input:{
  provider:AiProviderDescriptor;
  modeLabel:string;
  payload:string;
  recordCount:number;
  excludedSensitiveCategories:number;
  analysisMode:AiAnalysisMode;
  taskKind?:string;
  disclosureNotice:string;
}):AiFirewallPreview{
  const notices=[
    "Preview only: no network request has been made.",
    "Internal record IDs, provider transaction IDs, import provenance, and authentication data are never included.",
    input.disclosureNotice,
    `Provider trust: ${input.provider.trust}.`,
    input.provider.transmissionEnabled
      ?"Transmission requires an explicit send after this exact preview."
      :"Configured for review only: remote/cloud transmission is disabled in this milestone."
  ];
  return{
    destination:input.provider.endpoint,
    providerLabel:input.provider.label,
    modeLabel:input.modeLabel,
    trust:input.provider.trust,
    verifiedLocalhost:input.provider.trust==="local",
    transmissionEnabled:input.provider.transmissionEnabled,
    payload:input.payload,
    recordCount:input.recordCount,
    excludedSensitiveCategories:input.excludedSensitiveCategories,
    notices,
    analysisMode:input.analysisMode,
    taskKind:input.taskKind
  };
}

function aggregateData(accounts:readonly Account[],transactions:readonly Transaction[]){
  const accountMap=new Map(accounts.map(account=>[account.id,account])),currencies=new Map<string,{accountCount:number;transactionCount:number;incomeMinor:number;spendingMinor:number;netMinor:number}>();
  for(const account of accounts){const row=currencies.get(account.currency)??{accountCount:0,transactionCount:0,incomeMinor:0,spendingMinor:0,netMinor:0};row.accountCount++;currencies.set(account.currency,row);}
  for(const item of transactions){const currency=accountMap.get(item.accountId)!.currency,row=currencies.get(currency)!;row.transactionCount++;if(item.amountMinor>=0)row.incomeMinor=safeAdd(row.incomeMinor,item.amountMinor);else row.spendingMinor=safeAdd(row.spendingMinor,-item.amountMinor);row.netMinor=safeAdd(row.netMinor,item.amountMinor);}
  const dates=transactions.map(item=>item.postedDate).sort();
  return{dateRange:dates.length?{from:dates[0].slice(0,7),to:dates.at(-1)!.slice(0,7)}:null,currencies:[...currencies].sort(([left],[right])=>left.localeCompare(right)).map(([currency,values])=>({currency,...values}))};
}
function redactedTransaction(item:Transaction,account:Account){return{accountAlias:alias("Account",item.accountId),accountType:account.type,month:item.postedDate.slice(0,7),merchantAlias:alias("Merchant",item.payee.toLocaleLowerCase()),category:SENSITIVE_CATEGORY.test(item.category)?"Removed-sensitive":alias("Category",item.category.toLocaleLowerCase()),amountBandMinor:amountBand(item.amountMinor),currency:account.currency};}
function customTransaction(item:Transaction,account:Account,fields:Set<CustomDisclosureField>){const row:Record<string,string|number>={currency:account.currency};if(fields.has("accountType"))row.accountType=account.type;if(fields.has("month"))row.month=item.postedDate.slice(0,7);if(fields.has("amountBand"))row.amountBandMinor=amountBand(item.amountMinor);if(fields.has("merchantAlias"))row.merchantAlias=alias("Merchant",item.payee.toLocaleLowerCase());if(fields.has("categoryAlias"))row.categoryAlias=SENSITIVE_CATEGORY.test(item.category)?"Removed-sensitive":alias("Category",item.category.toLocaleLowerCase());return row;}
function fullLocalTransaction(item:Transaction,account:Account){return{accountName:account.name,accountType:account.type,currency:account.currency,postedDate:item.postedDate,payee:item.payee,category:item.category,amountMinor:item.amountMinor,status:item.status,memo:item.memo};}
function amountBand(value:number):number{return Math.round(value/1000)*1000;}
function alias(prefix:string,value:string):string{return`${prefix}-${fnv1a(value).toString(16).toUpperCase().padStart(8,"0")}`;}
function fnv1a(value:string):number{let hash=0x811c9dc5;for(let index=0;index<value.length;index++){hash^=value.charCodeAt(index);hash=Math.imul(hash,0x01000193);}return hash>>>0;}
function safeAdd(left:number,right:number):number{const result=left+right;if(!Number.isSafeInteger(result))throw new Error("AI aggregate total is too large");return result;}
function modeLabel(mode:AiDisclosureMode):string{return mode==="aggregate"?"Aggregate Only":mode==="redacted"?"Redacted Transactions":mode==="custom"?"Custom field selection":"Full Local Context";}

export{serializeAiTaskContext};
