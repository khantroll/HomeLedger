import {useMemo,useState,type FormEvent} from "react";
import {Bot,Eye,LockKeyhole,Server,ShieldCheck} from "lucide-react";
import type {Account,Transaction} from "./domain";
import {buildAiFirewallPreview,LOCAL_PROVIDER_PRESETS,type AiDisclosureMode,type AiFirewallPreview,type CustomDisclosureField,type LocalAiProviderKind} from "./aiPrivacy";
import "./aiInsights.css";

const disclosureOptions:{value:AiDisclosureMode;label:string;detail:string}[]=[
  {value:"aggregate",label:"Aggregate Only",detail:"Totals and counts by currency. Default and most private."},
  {value:"redacted",label:"Redacted Transactions",detail:"Stable aliases, month-only dates, and $10 amount bands."},
  {value:"custom",label:"Custom field selection",detail:"Include only the minimized fields you select."},
  {value:"full-local",label:"Full Local Context",detail:"Exact ledger descriptions for a verified localhost model only."}
];
const customOptions:{value:CustomDisclosureField;label:string}[]=[{value:"accountType",label:"Account type"},{value:"month",label:"Transaction month"},{value:"amountBand",label:"$10 amount band"},{value:"merchantAlias",label:"Merchant alias"},{value:"categoryAlias",label:"Category alias"}];

export function AiInsightsPage({accounts,transactions}:{accounts:Account[];transactions:Transaction[]}){
  const [kind,setKind]=useState<LocalAiProviderKind>("ollama"),[endpoint,setEndpoint]=useState(LOCAL_PROVIDER_PRESETS.ollama.endpoint),[model,setModel]=useState(""),[purpose,setPurpose]=useState(""),[mode,setMode]=useState<AiDisclosureMode>("aggregate"),[customFields,setCustomFields]=useState<Set<CustomDisclosureField>>(new Set(["accountType","month","amountBand"])),[preview,setPreview]=useState<AiFirewallPreview|null>(null),[error,setError]=useState("");
  const providerLabel=kind==="ollama"?"Ollama":kind==="lm-studio"?"LM Studio":"OpenAI-compatible localhost";
  const payloadSize=useMemo(()=>preview?new TextEncoder().encode(preview.payload).byteLength:0,[preview]);
  function changeKind(next:LocalAiProviderKind){setKind(next);if(next==="ollama")setEndpoint(LOCAL_PROVIDER_PRESETS.ollama.endpoint);else if(next==="lm-studio")setEndpoint(LOCAL_PROVIDER_PRESETS["lm-studio"].endpoint);setPreview(null);setError("");}
  function submit(event:FormEvent){event.preventDefault();setError("");try{setPreview(buildAiFirewallPreview({provider:{kind,endpoint,model},purpose,mode,accounts,transactions,customFields:[...customFields]}));}catch(reason){setPreview(null);setError(reason instanceof Error?reason.message:String(reason));}}
  function toggle(field:CustomDisclosureField){setCustomFields(current=>{const next=new Set(current);if(next.has(field))next.delete(field);else next.add(field);return next;});setPreview(null);}
  return <div className="ai-page">
    <section className="ai-safety-banner"><ShieldCheck/><div><strong>Local preview foundation</strong><span>This workspace cannot send requests or change ledger records. It only constructs the exact payload for your review.</span></div></section>
    <div className="ai-layout">
      <form className="panel ai-controls" onSubmit={submit}>
        <div className="panel-heading"><div><h2>Local model provider</h2><p>Configuration stays in memory and is not saved yet</p></div><Server size={18}/></div>
        <div className="ai-form">
          <label>Provider<select value={kind} onChange={event=>changeKind(event.target.value as LocalAiProviderKind)}><option value="ollama">Ollama</option><option value="lm-studio">LM Studio</option><option value="openai-compatible-local">OpenAI-compatible localhost</option></select></label>
          <label>Local endpoint<input value={endpoint} onChange={event=>{setEndpoint(event.target.value);setPreview(null);}} inputMode="url" spellCheck={false}/><small>Only localhost, 127.0.0.1, or ::1 is accepted.</small></label>
          <label>Model name<input value={model} onChange={event=>{setModel(event.target.value);setPreview(null);}} placeholder={kind==="ollama"?"qwen3.5:9b":"Local model identifier"}/></label>
          <label>Analysis purpose / question<textarea value={purpose} onChange={event=>{setPurpose(event.target.value);setPreview(null);}} placeholder="Explain changes in household spending without giving financial advice."/><small>Your wording is included verbatim in the preview.</small></label>
          <fieldset><legend>Disclosure mode</legend>{disclosureOptions.map(option=><label className={mode===option.value?"ai-mode selected":"ai-mode"} key={option.value}><input type="radio" name="disclosure" value={option.value} checked={mode===option.value} onChange={()=>{setMode(option.value);setPreview(null);}}/><span><strong>{option.label}</strong><small>{option.detail}</small></span></label>)}</fieldset>
          {mode==="custom"&&<fieldset><legend>Custom payload fields</legend><div className="ai-custom-fields">{customOptions.map(option=><label key={option.value}><input type="checkbox" checked={customFields.has(option.value)} onChange={()=>toggle(option.value)}/>{option.label}</label>)}</div></fieldset>}
          {mode==="full-local"&&<div className="ai-warning"><LockKeyhole/><span>Full Local Context contains exact account names, dates, payees, categories, amounts, and memos. It remains locked to a verified loopback address.</span></div>}
          {error&&<p className="form-error" role="alert">{error}</p>}
          <button className="primary-action ai-preview-button"><Eye size={15}/> Build exact preview</button>
        </div>
      </form>
      <section className="panel ai-preview">
        <div className="panel-heading"><div><h2>Privacy Firewall</h2><p>Nothing leaves this device in v0.35</p></div><LockKeyhole size={18}/></div>
        {!preview?<div className="ai-preview-empty"><Bot size={30}/><strong>No payload constructed</strong><span>Choose the minimum disclosure needed, then build a preview.</span></div>:<>
          <dl className="ai-preview-meta"><div><dt>Destination</dt><dd>{preview.destination}</dd></div><div><dt>Provider</dt><dd>{providerLabel}</dd></div><div><dt>Model</dt><dd>{model.trim()}</dd></div><div><dt>Disclosure</dt><dd>{preview.modeLabel}</dd></div><div><dt>Ledger rows considered</dt><dd>{preview.recordCount}</dd></div><div><dt>Payload size</dt><dd>{payloadSize.toLocaleString()} bytes</dd></div><div><dt>Localhost verified</dt><dd>Yes</dd></div></dl>
          {preview.excludedSensitiveCategories>0&&<div className="ai-sensitive-note">Removed or aliased {preview.excludedSensitiveCategories} sensitive-category record{preview.excludedSensitiveCategories===1?"":"s"}.</div>}
          <div className="ai-payload-heading"><strong>Exact payload</strong><span>Review every field below</span></div><pre>{preview.payload}</pre>
          <ul className="ai-notices">{preview.notices.map(notice=><li key={notice}>{notice}</li>)}</ul>
          <button className="ai-locked-button" disabled><LockKeyhole size={14}/> Transmission locked in this milestone</button>
        </>}
      </section>
    </div>
    <section className="panel ai-cloud-disabled"><LockKeyhole/><div><strong>Cloud providers are disabled</strong><p>OpenAI, Anthropic, Gemini, Mistral, and remote compatible APIs will require credential-vault storage, an explicit provider allow-list, this exact payload review, and per-request confirmation before they can be enabled.</p></div></section>
  </div>;
}
