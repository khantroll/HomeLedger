import {useEffect,useMemo,useState,type FormEvent} from "react";
import {Bot,Eye,KeyRound,LockKeyhole,Send,Server,ShieldCheck,Wifi} from "lucide-react";
import type {Account,BudgetMonth,DebtPlan,SavingsGoal,ScheduledOccurrence,ScheduledTransaction,Transaction} from "./domain";
import {parseMoney} from "./domain";
import {
  buildAiFirewallPreview,
  buildAiTaskFirewallPreview,
  LOCAL_PROVIDER_PRESETS,
  prepareReviewedTransmission,
  validateLocalAiProvider,
  type AiAnalysisMode,
  type AiDisclosureMode,
  type AiFirewallPreview,
  type CustomDisclosureField,
  type LocalAiProviderKind
} from "./aiPrivacy";
import {
  CLOUD_PROVIDER_PRESETS,
  cloudProviderDescriptor,
  isEnabledCloudProvider,
  localProviderDescriptor,
  validateProviderEndpoint,
  type CloudProviderDraft,
  type EnabledCloudProviderType
} from "./aiProvider";
import {buildAffordabilityAnalysisContext,buildSpendingChangeAnalysisContext,defaultSpendingChangePeriods,type AiTaskKind,type SpendingChangeAnalysisContext} from "./aiTaskContext";
import {assertCloudSendConfirmation,presentAiAdviceText} from "./aiCloud";
import {validateCredentialAccountId,validateCredentialSecret} from "./aiCredentials";
import {aiRepository,financeRepository as repository,isNativeApp} from "./repository";
import {addDaysIso,todayIso} from "./scheduledPresentation";
import {forecastMonths} from "./forecastMath";
import "./aiInsights.css";
import "./aiLocalAdapter.css";

const disclosureOptions:{value:AiDisclosureMode;label:string;detail:string}[]=[
  {value:"aggregate",label:"Aggregate Only",detail:"Totals and counts by currency. Default and most private."},
  {value:"redacted",label:"Redacted Transactions",detail:"Stable aliases, month-only dates, and $10 amount bands."},
  {value:"custom",label:"Custom field selection",detail:"Include only the minimized fields you select."},
  {value:"full-local",label:"Full Local Context",detail:"Exact ledger descriptions for a verified localhost model only."}
];
const customOptions:{value:CustomDisclosureField;label:string}[]=[{value:"accountType",label:"Account type"},{value:"month",label:"Transaction month"},{value:"amountBand",label:"$10 amount band"},{value:"merchantAlias",label:"Merchant alias"},{value:"categoryAlias",label:"Category alias"}];

function money(minor:number,currency:string):string{
  return new Intl.NumberFormat(undefined,{style:"currency",currency}).format(minor/100);
}

export function AiInsightsPage({
  accounts,
  transactions,
  templates,
  occurrences,
  budgets,
  today=todayIso()
}:{
  accounts:Account[];
  transactions:Transaction[];
  templates:ScheduledTransaction[];
  occurrences:ScheduledOccurrence[];
  budgets:BudgetMonth[];
  today?:string;
}){
  const currencies=useMemo(()=>[...new Set(accounts.map(item=>item.currency))].sort(),[accounts]);
  const defaultPeriods=useMemo(()=>defaultSpendingChangePeriods(today),[today]);
  const [analysisMode,setAnalysisMode]=useState<AiAnalysisMode>("task");
  const [taskKind,setTaskKind]=useState<AiTaskKind>("affordability-analysis");
  const [kind,setKind]=useState<LocalAiProviderKind>("ollama");
  const [endpoint,setEndpoint]=useState(LOCAL_PROVIDER_PRESETS.ollama.endpoint);
  const [model,setModel]=useState("");
  const [purpose,setPurpose]=useState("Can I afford another $50 per month?");
  const [proposedCost,setProposedCost]=useState("50.00");
  const [analysisFrom,setAnalysisFrom]=useState(defaultPeriods.analysis.fromDate);
  const [analysisTo,setAnalysisTo]=useState(defaultPeriods.analysis.toDate);
  const [comparisonFrom,setComparisonFrom]=useState(defaultPeriods.comparison.fromDate);
  const [comparisonTo,setComparisonTo]=useState(defaultPeriods.comparison.toDate);
  const [currency,setCurrency]=useState(currencies[0]??"USD");
  const [mode,setMode]=useState<AiDisclosureMode>("aggregate");
  const [customFields,setCustomFields]=useState<Set<CustomDisclosureField>>(new Set(["accountType","month","amountBand"]));
  const [preview,setPreview]=useState<AiFirewallPreview|null>(null);
  const [spendingFindings,setSpendingFindings]=useState<SpendingChangeAnalysisContext|null>(null);
  const [error,setError]=useState("");
  const [connectionNotice,setConnectionNotice]=useState("");
  const [testing,setTesting]=useState(false);
  const [sending,setSending]=useState(false);
  const [answer,setAnswer]=useState("");
  const [cloudConfirm,setCloudConfirm]=useState(false);
  const [debtPlan,setDebtPlan]=useState<DebtPlan|undefined>();
  const [savingsGoals,setSavingsGoals]=useState<SavingsGoal[]>([]);
  const [taskBudgets,setTaskBudgets]=useState<BudgetMonth[]>(budgets);
  const [taskOccurrences,setTaskOccurrences]=useState<ScheduledOccurrence[]>(occurrences);

  const [cloudType,setCloudType]=useState<CloudProviderDraft["type"]>("openai");
  const [cloudEndpoint,setCloudEndpoint]=useState(CLOUD_PROVIDER_PRESETS.openai.endpoint);
  const [cloudModel,setCloudModel]=useState(CLOUD_PROVIDER_PRESETS.openai.defaultModel);
  const [cloudSecret,setCloudSecret]=useState("");
  const [cloudConfigured,setCloudConfigured]=useState(false);
  const [cloudNotice,setCloudNotice]=useState("");
  const [cloudBusy,setCloudBusy]=useState(false);

  const payloadSize=useMemo(()=>preview?new TextEncoder().encode(preview.payload).byteLength:0,[preview]);
  const cloudAccountId=cloudType==="openai-compatible-remote"?`cloud:openai-compatible-remote:custom`:CLOUD_PROVIDER_PRESETS[cloudType].accountId;
  const previewIsCloud=preview?.trust==="cloud";
  const cloudEnabled=isEnabledCloudProvider(cloudType);
  const cloudLabel=cloudType==="openai-compatible-remote"?"Remote OpenAI-compatible":CLOUD_PROVIDER_PRESETS[cloudType].label;

  useEffect(()=>{setPreview(null);setSpendingFindings(null);setAnswer("");setCloudConfirm(false);},[accounts,transactions,templates,occurrences,budgets]);
  useEffect(()=>{if(currencies.length&&!currencies.includes(currency))setCurrency(currencies[0]);},[currencies,currency]);
  useEffect(()=>{setTaskBudgets(budgets);setTaskOccurrences(occurrences);},[budgets,occurrences]);
  useEffect(()=>{
    setAnalysisFrom(defaultPeriods.analysis.fromDate);
    setAnalysisTo(defaultPeriods.analysis.toDate);
    setComparisonFrom(defaultPeriods.comparison.fromDate);
    setComparisonTo(defaultPeriods.comparison.toDate);
  },[defaultPeriods]);
  useEffect(()=>{
    let current=true;
    void Promise.all([
      repository.getDebtPlan(currency).catch(()=>undefined),
      repository.listSavingsGoals().catch(()=>[] as SavingsGoal[]),
      repository.generateScheduledOccurrences({fromDate:today,toDate:addDaysIso(today,89)}).then(()=>repository.listScheduledOccurrences({fromDate:today,toDate:addDaysIso(today,89)})),
      Promise.all(forecastMonths(today,90).map(month=>repository.getBudgetMonth(month)))
    ]).then(([nextDebt,nextGoals,nextOccurrences,nextBudgets])=>{
      if(!current)return;
      setDebtPlan(nextDebt);
      setSavingsGoals(nextGoals);
      setTaskOccurrences(nextOccurrences);
      setTaskBudgets(nextBudgets);
    }).catch(()=>{/* keep overview data */});
    return()=>{current=false;};
  },[currency,today]);
  useEffect(()=>{
    let current=true;
    if(!isNativeApp){setCloudConfigured(false);return;}
    void aiRepository.credentialStatus(cloudAccountId).then(status=>{if(current)setCloudConfigured(status.configured);}).catch(()=>{if(current)setCloudConfigured(false);});
    return()=>{current=false;};
  },[cloudAccountId]);

  function buildAffordabilityContext(){
    return buildAffordabilityAnalysisContext({
      question:purpose,
      currency,
      proposedMonthlyCostMinor:parseMoney(proposedCost),
      asOfDate:today,
      accounts,
      transactions,
      templates,
      occurrences:taskOccurrences,
      budgets:taskBudgets,
      debtPlan,
      savingsGoals
    });
  }

  function buildSpendingChangeContext(){
    return buildSpendingChangeAnalysisContext({
      question:purpose,
      currency,
      asOfDate:today,
      analysisPeriod:{fromDate:analysisFrom,toDate:analysisTo},
      comparisonPeriod:{fromDate:comparisonFrom,toDate:comparisonTo},
      accounts,
      transactions,
      templates
    });
  }

  function buildSelectedTaskContext(){
    return taskKind==="spending-change-analysis"?buildSpendingChangeContext():buildAffordabilityContext();
  }

  function changeTaskKind(next:AiTaskKind){
    setTaskKind(next);
    setPurpose(next==="spending-change-analysis"?"Why was this month expensive?":"Can I afford another $50 per month?");
    setPreview(null);setSpendingFindings(null);setAnswer("");setError("");setCloudConfirm(false);
  }

  function changeKind(next:LocalAiProviderKind){
    setKind(next);
    if(next==="ollama")setEndpoint(LOCAL_PROVIDER_PRESETS.ollama.endpoint);
    else if(next==="lm-studio")setEndpoint(LOCAL_PROVIDER_PRESETS["lm-studio"].endpoint);
    setPreview(null);setAnswer("");setConnectionNotice("");setError("");setCloudConfirm(false);
  }

  function changeCloudType(next:CloudProviderDraft["type"]){
    setCloudType(next);
    if(next!=="openai-compatible-remote"){
      setCloudEndpoint(CLOUD_PROVIDER_PRESETS[next].endpoint);
      setCloudModel(CLOUD_PROVIDER_PRESETS[next].defaultModel);
    }
    setCloudSecret("");setCloudNotice("");setPreview(null);setAnswer("");setCloudConfirm(false);
  }

  async function submit(event:FormEvent){
    event.preventDefault();
    setError("");setAnswer("");setCloudConfirm(false);
    try{
      if(analysisMode==="task"){
        const local=validateLocalAiProvider({kind,endpoint,model});
        const taskContext=buildSelectedTaskContext();
        if(taskContext.task==="spending-change-analysis")setSpendingFindings(taskContext);
        else setSpendingFindings(null);
        setPreview(buildAiTaskFirewallPreview({provider:localProviderDescriptor(local),taskContext}));
      }else{
        setSpendingFindings(null);
        setPreview(buildAiFirewallPreview({provider:{kind,endpoint,model},purpose,mode,accounts,transactions,customFields:[...customFields]}));
      }
    }catch(reason){
      setPreview(null);
      setSpendingFindings(null);
      setError(reason instanceof Error?reason.message:String(reason));
    }
  }

  async function testConnection(){
    setTesting(true);setError("");setConnectionNotice("");
    try{
      const provider=validateLocalAiProvider({kind,endpoint,model:model.trim()||"connection-test"});
      await aiRepository.testConnection(provider.endpoint);
      setConnectionNotice("Local provider responded successfully.");
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{setTesting(false);}
  }

  async function sendReviewed(){
    if(!preview)return;
    setSending(true);setError("");setAnswer("");
    try{
      if(preview.trust==="cloud"){
        assertCloudSendConfirmation({providerLabel:preview.providerLabel,previewPayload:preview.payload,confirmed:cloudConfirm});
        if(!isEnabledCloudProvider(cloudType))throw new Error(`${cloudLabel} cloud transmission is not enabled yet`);
        const provider=validateProviderEndpoint(cloudProviderDescriptor({
          type:cloudType,
          endpoint:cloudEndpoint,
          model:cloudModel.trim(),
          accountId:cloudAccountId
        }));
        const request=prepareReviewedTransmission(provider,preview,{explicitConfirmation:true});
        if(request.payload!==preview.payload)throw new Error("Reviewed payload no longer matches the transmission request");
        const result=await aiRepository.queryCloud({
          provider:request.type as EnabledCloudProviderType,
          endpoint:request.endpoint,
          model:request.model,
          payload:request.payload,
          accountId:request.accountId,
          confirmed:true
        });
        setAnswer(presentAiAdviceText(result.answer));
      }else{
        const local=validateLocalAiProvider({kind,endpoint,model});
        const provider=localProviderDescriptor(local);
        const request=prepareReviewedTransmission(provider,preview);
        const result=await aiRepository.queryLocal(request);
        setAnswer(presentAiAdviceText(result.answer));
      }
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{setSending(false);}
  }

  async function saveCloudCredential(event:FormEvent){
    event.preventDefault();
    setCloudBusy(true);setCloudNotice("");setError("");
    try{
      const descriptor=validateProviderEndpoint(cloudProviderDescriptor({
        type:cloudType,
        endpoint:cloudEndpoint,
        model:cloudModel.trim()||"credential-setup",
        accountId:cloudAccountId
      }));
      const accountId=validateCredentialAccountId(descriptor.accountId);
      const secret=validateCredentialSecret(cloudSecret);
      const status=await aiRepository.saveCredential(accountId,secret);
      setCloudConfigured(status.configured);
      setCloudSecret("");
      setCloudNotice(descriptor.transmissionEnabled
        ?`${descriptor.label} credential stored in the OS vault. Affordability analysis can be sent after exact payload review and explicit confirmation.`
        :`${descriptor.label} credential stored in the OS vault. Transmission remains disabled for this provider.`);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{setCloudBusy(false);}
  }

  async function clearCloudCredential(){
    setCloudBusy(true);setCloudNotice("");setError("");
    try{
      const status=await aiRepository.clearCredential(validateCredentialAccountId(cloudAccountId));
      setCloudConfigured(status.configured);
      setCloudNotice("Cloud credential cleared from the OS vault.");
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{setCloudBusy(false);}
  }

  function previewCloudTask(){
    setError("");setAnswer("");setCloudConfirm(false);
    try{
      if(!isEnabledCloudProvider(cloudType))throw new Error(`${cloudLabel} cloud transmission is not enabled yet`);
      const provider=validateProviderEndpoint(cloudProviderDescriptor({
        type:cloudType,
        endpoint:cloudEndpoint,
        model:cloudModel.trim()||CLOUD_PROVIDER_PRESETS[cloudType].defaultModel||"cloud-model",
        accountId:cloudAccountId
      }));
      const taskContext=buildSelectedTaskContext();
      if(taskContext.task==="spending-change-analysis")setSpendingFindings(taskContext);
      else setSpendingFindings(null);
      setPreview(buildAiTaskFirewallPreview({provider,taskContext}));
      setCloudNotice(`Review the exact payload. ${provider.label} transmission leaves this device and requires explicit confirmation.`);
    }catch(reason){
      setPreview(null);
      setSpendingFindings(null);
      setError(reason instanceof Error?reason.message:String(reason));
    }
  }

  function toggle(field:CustomDisclosureField){
    setCustomFields(current=>{
      const next=new Set(current);
      if(next.has(field))next.delete(field);else next.add(field);
      return next;
    });
    setPreview(null);setAnswer("");setCloudConfirm(false);
  }

  return <div className="ai-page">
    <section className="ai-safety-banner"><ShieldCheck/><div><strong>Reviewed analysis</strong><span>Task contexts prefer deterministic HomeLedger facts. Local loopback and enabled cloud adapters require exact Privacy Firewall review. AI answers cannot change ledger records.</span></div></section>
    <div className="ai-layout">
      <form className="panel ai-controls" onSubmit={submit}>
        <div className="panel-heading"><div><h2>Local model provider</h2><p>Configuration stays in memory and is not saved yet</p></div><Server size={18}/></div>
        <div className="ai-form">
          <fieldset><legend>Analysis mode</legend>
            <label className={analysisMode==="task"&&taskKind==="affordability-analysis"?"ai-mode selected":"ai-mode"}><input type="radio" name="analysis-mode" checked={analysisMode==="task"&&taskKind==="affordability-analysis"} onChange={()=>{setAnalysisMode("task");changeTaskKind("affordability-analysis");}}/><span><strong>Affordability Analysis</strong><small>Deterministic task context for questions like “Can I afford another $50 per month?”</small></span></label>
            <label className={analysisMode==="task"&&taskKind==="spending-change-analysis"?"ai-mode selected":"ai-mode"}><input type="radio" name="analysis-mode" checked={analysisMode==="task"&&taskKind==="spending-change-analysis"} onChange={()=>{setAnalysisMode("task");changeTaskKind("spending-change-analysis");}}/><span><strong>Spending Change Analysis</strong><small>Compare periods to explain “Why was this month expensive?”</small></span></label>
            <label className={analysisMode==="adhoc"?"ai-mode selected":"ai-mode"}><input type="radio" name="analysis-mode" checked={analysisMode==="adhoc"} onChange={()=>{setAnalysisMode("adhoc");setPreview(null);setSpendingFindings(null);setAnswer("");setCloudConfirm(false);}}/><span><strong>Custom / ad-hoc question</strong><small>Uses Aggregate Only, Redacted, Custom, or Full Local Context disclosure modes.</small></span></label>
          </fieldset>
          <label>Provider<select value={kind} onChange={event=>changeKind(event.target.value as LocalAiProviderKind)}><option value="ollama">Ollama</option><option value="lm-studio">LM Studio</option><option value="openai-compatible-local">OpenAI-compatible localhost</option></select></label>
          <label>Local endpoint<input value={endpoint} onChange={event=>{setEndpoint(event.target.value);setPreview(null);setAnswer("");setConnectionNotice("");setCloudConfirm(false);}} inputMode="url" spellCheck={false}/><small>Only HTTP on localhost, 127.0.0.1, or ::1 is accepted.</small></label>
          <label>Model name<input value={model} onChange={event=>{setModel(event.target.value);setPreview(null);setAnswer("");setCloudConfirm(false);}} placeholder={kind==="ollama"?"qwen3.5:9b":"Local model identifier"}/></label>
          <label>Analysis purpose / question<textarea value={purpose} onChange={event=>{setPurpose(event.target.value);setPreview(null);setAnswer("");setCloudConfirm(false);}} placeholder="Can I afford another $50 per month?"/><small>Your wording is included verbatim in the preview.</small></label>
          {analysisMode==="task"&&taskKind==="affordability-analysis"&&<>
            <label>Currency<select value={currency} onChange={event=>{setCurrency(event.target.value);setPreview(null);setAnswer("");setCloudConfirm(false);}}>{currencies.length?currencies.map(item=><option key={item}>{item}</option>):<option>USD</option>}</select></label>
            <label>Proposed monthly cost<input value={proposedCost} onChange={event=>{setProposedCost(event.target.value);setPreview(null);setAnswer("");setCloudConfirm(false);}} inputMode="decimal"/><small>Converted locally into minor units before the task context is built.</small></label>
          </>}
          {analysisMode==="task"&&taskKind==="spending-change-analysis"&&<>
            <label>Currency<select value={currency} onChange={event=>{setCurrency(event.target.value);setPreview(null);setSpendingFindings(null);setAnswer("");setCloudConfirm(false);}}>{currencies.length?currencies.map(item=><option key={item}>{item}</option>):<option>USD</option>}</select></label>
            <fieldset><legend>Analysis period</legend>
              <label>From<input type="date" value={analysisFrom} onChange={event=>{setAnalysisFrom(event.target.value);setPreview(null);setSpendingFindings(null);setAnswer("");setCloudConfirm(false);}}/></label>
              <label>To<input type="date" value={analysisTo} onChange={event=>{setAnalysisTo(event.target.value);setPreview(null);setSpendingFindings(null);setAnswer("");setCloudConfirm(false);}}/></label>
            </fieldset>
            <fieldset><legend>Comparison period</legend>
              <label>From<input type="date" value={comparisonFrom} onChange={event=>{setComparisonFrom(event.target.value);setPreview(null);setSpendingFindings(null);setAnswer("");setCloudConfirm(false);}}/></label>
              <label>To<input type="date" value={comparisonTo} onChange={event=>{setComparisonTo(event.target.value);setPreview(null);setSpendingFindings(null);setAnswer("");setCloudConfirm(false);}}/></label>
              <small>Defaults to month-to-date versus the same number of days in the prior month.</small>
            </fieldset>
          </>}
          {analysisMode==="adhoc"&&<>
            <fieldset><legend>Disclosure mode</legend>{disclosureOptions.map(option=><label className={mode===option.value?"ai-mode selected":"ai-mode"} key={option.value}><input type="radio" name="disclosure" value={option.value} checked={mode===option.value} onChange={()=>{setMode(option.value);setPreview(null);setAnswer("");setCloudConfirm(false);}}/><span><strong>{option.label}</strong><small>{option.detail}</small></span></label>)}</fieldset>
            {mode==="custom"&&<fieldset><legend>Custom payload fields</legend><div className="ai-custom-fields">{customOptions.map(option=><label key={option.value}><input type="checkbox" checked={customFields.has(option.value)} onChange={()=>toggle(option.value)}/>{option.label}</label>)}</div></fieldset>}
            {mode==="full-local"&&<div className="ai-warning"><LockKeyhole/><span>Full Local Context contains exact account names, dates, payees, categories, amounts, and memos. It remains locked to a verified loopback address.</span></div>}
          </>}
          {error&&<p className="form-error" role="alert">{error}</p>}
          {connectionNotice&&<p className="success-banner ai-inline-notice" role="status">{connectionNotice}</p>}
          <div className="ai-control-actions"><button type="button" disabled={!isNativeApp||testing} onClick={()=>void testConnection()}><Wifi size={15}/>{testing?"Testing…":"Test local connection"}</button><button className="primary-action ai-preview-button"><Eye size={15}/> Build exact preview</button></div>
          {!isNativeApp&&<small className="ai-native-note">Connection testing and model requests require the native desktop application.</small>}
        </div>
      </form>
      <section className="panel ai-preview">
        <div className="panel-heading"><div><h2>Privacy Firewall</h2><p>{previewIsCloud?"Cloud destination — leaves this device":"Reviewed loopback requests"}</p></div><LockKeyhole size={18}/></div>
        {spendingFindings&&<div className="ai-findings" aria-live="polite">
          <strong>HomeLedger spending findings</strong>
          <p>{money(spendingFindings.changeSummary.spendingDifferenceMinor,spendingFindings.currency)} spending change ({spendingFindings.analysisPeriod.fromDate}–{spendingFindings.analysisPeriod.toDate} vs {spendingFindings.comparisonPeriod.fromDate}–{spendingFindings.comparisonPeriod.toDate}).</p>
          <ul>
            {spendingFindings.changeSummary.topIncreaseCategories.slice(0,3).map(item=><li key={`up-${item.category}`}>Up {money(item.changeMinor,spendingFindings.currency)} in {item.category}</li>)}
            {spendingFindings.changeSummary.topDecreaseCategories.slice(0,2).map(item=><li key={`down-${item.category}`}>Down {money(Math.abs(item.changeMinor),spendingFindings.currency)} in {item.category}</li>)}
            {spendingFindings.notableTransactions.slice(0,3).map(item=><li key={`${item.postedDate}-${item.merchantAlias}`}>{money(item.amountMinor,spendingFindings.currency)} {item.reason.replace("-"," ")} on {item.postedDate} ({item.category})</li>)}
            {spendingFindings.changeSummary.recurringExpenseChangeMinor!==0&&<li>Recurring/scheduled spending changed by {money(spendingFindings.changeSummary.recurringExpenseChangeMinor,spendingFindings.currency)}</li>}
          </ul>
          <small>{spendingFindings.periodLimitations.note}</small>
        </div>}
        {!preview?<div className="ai-preview-empty"><Bot size={30}/><strong>No payload constructed</strong><span>Prefer a structured task analysis, then build a preview.</span></div>:<>
          <dl className="ai-preview-meta">
            <div><dt>Destination</dt><dd>{preview.destination}</dd></div>
            <div><dt>Provider</dt><dd>{preview.providerLabel}</dd></div>
            <div><dt>Trust</dt><dd>{preview.trust}</dd></div>
            <div><dt>Model</dt><dd>{previewIsCloud?cloudModel.trim():model.trim()}</dd></div>
            <div><dt>Disclosure</dt><dd>{preview.modeLabel}</dd></div>
            <div><dt>Ledger rows considered</dt><dd>{preview.recordCount}</dd></div>
            <div><dt>Payload size</dt><dd>{payloadSize.toLocaleString()} bytes</dd></div>
            <div><dt>Localhost verified</dt><dd>{preview.verifiedLocalhost?"Yes":"No"}</dd></div>
          </dl>
          {previewIsCloud&&<div className="ai-warning" role="status"><LockKeyhole/><span>Destination is {preview.providerLabel} (cloud). The exact sanitized financial context shown below will leave this device if you confirm and send.</span></div>}
          {preview.excludedSensitiveCategories>0&&<div className="ai-sensitive-note">Removed or aliased {preview.excludedSensitiveCategories} sensitive-category record{preview.excludedSensitiveCategories===1?"":"s"}.</div>}
          <div className="ai-payload-heading"><strong>Exact payload</strong><span>Review every field below</span></div><pre>{preview.payload}</pre>
          <ul className="ai-notices">{preview.notices.map(notice=><li key={notice}>{notice}</li>)}<li>The native adapter adds a fixed read-only analyst instruction; it does not add ledger data.</li></ul>
          {previewIsCloud&&preview.transmissionEnabled&&<label className="ai-confirm"><input type="checkbox" checked={cloudConfirm} onChange={event=>setCloudConfirm(event.target.checked)}/><span>I reviewed this exact payload and confirm sending it to {preview.providerLabel} for analysis.</span></label>}
          {preview.transmissionEnabled
            ?<button className="ai-send-button" disabled={!isNativeApp||sending||(previewIsCloud&&!cloudConfirm)} onClick={()=>void sendReviewed()}><Send size={14}/>{sending?"Waiting for model…":previewIsCloud?`Send reviewed payload to ${preview.providerLabel}`:"Send reviewed payload to local model"}</button>
            :<button className="ai-locked-button" type="button" disabled><LockKeyhole size={14}/> Cloud transmission disabled</button>}
          {answer&&<article className="ai-answer" aria-live="polite"><div><Bot size={17}/><strong>{previewIsCloud?`AI-generated ${preview.providerLabel} analysis`:"Local AI answer"}</strong></div><p>{answer}</p><small>AI-generated analysis/advice only — not a ledger fact. HomeLedger did not change or recalculate any ledger record. Model text is untrusted and cannot mutate data.</small></article>}
        </>}
      </section>
    </div>
    <section className="panel ai-cloud-config">
      <div className="panel-heading"><div><h2>Cloud provider configuration</h2><p>OpenAI, Anthropic, and Gemini enabled with OS vault credentials</p></div><KeyRound size={18}/></div>
      <form className="ai-form" onSubmit={saveCloudCredential}>
        <label>Cloud provider<select value={cloudType} onChange={event=>changeCloudType(event.target.value as CloudProviderDraft["type"])}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="mistral">Mistral (not enabled)</option><option value="openai-compatible-remote">Remote OpenAI-compatible (blocked)</option></select></label>
        <label>HTTPS endpoint<input value={cloudEndpoint} onChange={event=>setCloudEndpoint(event.target.value)} inputMode="url" spellCheck={false} disabled={cloudType!=="openai-compatible-remote"}/><small>Approved hosts only. Arbitrary URLs fail closed.</small></label>
        <label>Cloud model name<input value={cloudModel} onChange={event=>{setCloudModel(event.target.value);setPreview(null);setAnswer("");setCloudConfirm(false);}} placeholder={cloudType==="anthropic"?"claude-sonnet-4-5":cloudType==="gemini"?"gemini-2.0-flash":"gpt-4.1-mini"}/></label>
        <label>API credential<input type="password" value={cloudSecret} onChange={event=>setCloudSecret(event.target.value)} autoComplete="off" spellCheck={false} placeholder={cloudConfigured?"Configured — enter a new value to replace":"Stored only in the OS credential vault"}/><small>HomeLedger never writes API credentials to SQLite, browser storage, config files, logs, backups, exports, or AI payloads. After save, the secret is not readable from the UI.</small></label>
        <div className="ai-cloud-status"><strong>Credential state:</strong> {cloudConfigured?"Configured":"Not configured"} <span>Account id: {cloudAccountId}</span></div>
        {cloudNotice&&<p className="success-banner ai-inline-notice" role="status">{cloudNotice}</p>}
        <div className="ai-control-actions">
          <button type="submit" disabled={!isNativeApp||cloudBusy||!cloudSecret}>{cloudBusy?"Saving…":cloudConfigured?"Replace credential in OS vault":"Save credential to OS vault"}</button>
          <button type="button" disabled={!isNativeApp||cloudBusy||!cloudConfigured} onClick={()=>void clearCloudCredential()}>Clear credential</button>
          <button type="button" disabled={cloudBusy||!cloudEnabled||analysisMode!=="task"} onClick={previewCloudTask}><Eye size={15}/> Preview {taskKind==="spending-change-analysis"?"spending change":"affordability"} for {cloudLabel}</button>
        </div>
        {!isNativeApp&&<small className="ai-native-note">OS credential vault access and cloud transmission require the native desktop application.</small>}
        <div className="ai-warning"><LockKeyhole/><span>Cloud requests use native HTTPS adapters only, never browser networking. Each send requires exact payload review and explicit confirmation. Mistral and arbitrary remote endpoints remain disabled.</span></div>
      </form>
    </section>
  </div>;
}
