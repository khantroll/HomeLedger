import type {AiDisclosureMode,LocalAiProviderConfig,LocalAiProviderKind} from "./aiPrivacy";

/** Trust classification drives disclosure capabilities and transmission policy. */
export type AiProviderTrust="local"|"self-hosted"|"cloud";
export type AiProviderType=
  |LocalAiProviderKind
  |"openai"
  |"anthropic"
  |"gemini"
  |"mistral"
  |"openai-compatible-remote"
  |"self-hosted-openai-compatible";
export type EnabledCloudProviderType=Extract<AiProviderType,"openai"|"anthropic">;
export type AiApiFamily="openai-chat-completions"|"anthropic-messages"|"google-generative-ai";

export const ENABLED_CLOUD_PROVIDERS=new Set<EnabledCloudProviderType>(["openai","anthropic"]);

export function isEnabledCloudProvider(type:AiProviderType):type is EnabledCloudProviderType{
  return ENABLED_CLOUD_PROVIDERS.has(type as EnabledCloudProviderType);
}

export interface AiProviderDescriptor{
  /** Stable provider/account id used for credential vault lookup. Never a secret. */
  accountId:string;
  type:AiProviderType;
  trust:AiProviderTrust;
  label:string;
  endpoint:string;
  model:string;
  apiFamily:AiApiFamily;
  requiresAuth:boolean;
  /** Cloud transmission is enabled only for first-class allow-listed adapters. */
  transmissionEnabled:boolean;
  allowedDisclosureModes:readonly AiDisclosureMode[];
  allowsTaskContexts:boolean;
  allowsFullLocalContext:boolean;
}

export interface CloudProviderDraft{
  type:Extract<AiProviderType,"openai"|"anthropic"|"gemini"|"mistral"|"openai-compatible-remote">;
  endpoint:string;
  model:string;
  accountId:string;
}

export const CLOUD_PROVIDER_PRESETS:Record<Exclude<CloudProviderDraft["type"],"openai-compatible-remote">,{label:string;endpoint:string;apiFamily:AiApiFamily;accountId:string;defaultModel:string}>={
  openai:{label:"OpenAI",endpoint:"https://api.openai.com/v1",apiFamily:"openai-chat-completions",accountId:"cloud:openai:default",defaultModel:"gpt-4.1-mini"},
  anthropic:{label:"Anthropic",endpoint:"https://api.anthropic.com",apiFamily:"anthropic-messages",accountId:"cloud:anthropic:default",defaultModel:"claude-sonnet-4-5"},
  gemini:{label:"Gemini",endpoint:"https://generativelanguage.googleapis.com/v1beta",apiFamily:"google-generative-ai",accountId:"cloud:gemini:default",defaultModel:""},
  mistral:{label:"Mistral",endpoint:"https://api.mistral.ai/v1",apiFamily:"openai-chat-completions",accountId:"cloud:mistral:default",defaultModel:""}
};

const APPROVED_CLOUD_HOSTS=new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.mistral.ai"
]);

const LOCAL_DISCLOSURE:readonly AiDisclosureMode[]=["aggregate","redacted","custom","full-local"];
const CLOUD_DISCLOSURE:readonly AiDisclosureMode[]=["aggregate","redacted","custom"];

export function localProviderDescriptor(provider:LocalAiProviderConfig):AiProviderDescriptor{
  const label=provider.kind==="ollama"?"Ollama":provider.kind==="lm-studio"?"LM Studio":"Local OpenAI-compatible";
  return{
    accountId:`local:${provider.kind}`,
    type:provider.kind,
    trust:"local",
    label,
    endpoint:provider.endpoint,
    model:provider.model,
    apiFamily:"openai-chat-completions",
    requiresAuth:false,
    transmissionEnabled:true,
    allowedDisclosureModes:LOCAL_DISCLOSURE,
    allowsTaskContexts:true,
    allowsFullLocalContext:true
  };
}

export function cloudProviderDescriptor(draft:CloudProviderDraft):AiProviderDescriptor{
  const preset=draft.type==="openai-compatible-remote"?undefined:CLOUD_PROVIDER_PRESETS[draft.type];
  const label=preset?.label??"Remote OpenAI-compatible";
  const apiFamily=preset?.apiFamily??"openai-chat-completions";
  const accountId=draft.accountId.trim()||preset?.accountId||`cloud:${draft.type}:custom`;
  return{
    accountId,
    type:draft.type,
    trust:"cloud",
    label,
    endpoint:draft.endpoint.trim().replace(/\/$/,""),
    model:draft.model.trim(),
    apiFamily,
    requiresAuth:true,
    transmissionEnabled:isEnabledCloudProvider(draft.type),
    allowedDisclosureModes:CLOUD_DISCLOSURE,
    allowsTaskContexts:true,
    allowsFullLocalContext:false
  };
}

export function disclosureAllowedForTrust(trust:AiProviderTrust,mode:AiDisclosureMode):boolean{
  if(mode==="full-local")return trust==="local";
  if(trust==="cloud"||trust==="self-hosted")return mode==="aggregate"||mode==="redacted"||mode==="custom";
  return true;
}

export function assertDisclosurePolicy(provider:AiProviderDescriptor,mode:AiDisclosureMode):void{
  if(!provider.allowedDisclosureModes.includes(mode)||!disclosureAllowedForTrust(provider.trust,mode)){
    throw new Error(`${provider.label} (${provider.trust}) does not permit ${modeLabel(mode)}`);
  }
  if(mode==="full-local"&&!provider.allowsFullLocalContext){
    throw new Error("Full Local Context is restricted to verified local providers");
  }
}

export function validateProviderEndpoint(provider:AiProviderDescriptor):AiProviderDescriptor{
  if(!provider.model.trim())throw new Error("Choose or enter a model name");
  let url:URL;
  try{url=new URL(provider.endpoint.trim());}catch{throw new Error("Enter a valid provider URL");}
  if(url.username||url.password||url.search||url.hash)throw new Error("Provider endpoint URLs cannot contain credentials, query strings, or fragments");
  if(provider.trust==="local"){
    if(url.protocol!=="http:")throw new Error("Local AI endpoints must use HTTP in this milestone");
    const host=url.hostname.toLowerCase();
    if(!["localhost","127.0.0.1","::1","[::1]"].includes(host))throw new Error("Local AI endpoints must use localhost or a loopback address");
  }else{
    if(url.protocol!=="https:")throw new Error("Remote and cloud AI endpoints must use HTTPS");
    if(provider.trust==="cloud"){
      const host=url.hostname.toLowerCase();
      if(provider.type==="openai-compatible-remote"){
        throw new Error("Arbitrary remote OpenAI-compatible endpoints are not approved for transmission");
      }
      if(!APPROVED_CLOUD_HOSTS.has(host))throw new Error(`Unapproved cloud endpoint host: ${host}`);
      if(provider.type!=="openai"&&provider.type!=="anthropic"&&provider.type!=="gemini"&&provider.type!=="mistral"){
        throw new Error("Unapproved cloud provider type");
      }
      assertApprovedCloudPath(provider.type,url);
    }else{
      throw new Error("Self-hosted remote providers are not enabled for transmission in this milestone");
    }
  }
  return{...provider,endpoint:url.toString().replace(/\/$/,""),model:provider.model.trim()};
}

export function assertTransmissionAllowed(provider:AiProviderDescriptor):void{
  const validated=validateProviderEndpoint(provider);
  if(!validated.transmissionEnabled){
    throw new Error(`${validated.label} is configured but cloud transmission is not enabled yet`);
  }
  if(validated.trust==="local")return;
  if(validated.trust==="cloud"&&isEnabledCloudProvider(validated.type))return;
  throw new Error("Only verified local providers and enabled first-class cloud adapters may transmit in this milestone");
}

export function providerAdapterContract():Readonly<{mayAccessRepository:false;mayMutateLedger:false;receivesOnlyReviewedPayload:true}>{
  return{mayAccessRepository:false,mayMutateLedger:false,receivesOnlyReviewedPayload:true};
}

function assertApprovedCloudPath(type:CloudProviderDraft["type"],url:URL):void{
  const path=url.pathname.replace(/\/$/,"").toLowerCase()||"/";
  if(type==="openai"&&path!=="/v1")throw new Error("OpenAI endpoints must use the /v1 API root");
  if(type==="anthropic"&&path!==""&&path!=="/")throw new Error("Anthropic endpoints must use the API root");
  if(type==="gemini"&&path!=="/v1beta")throw new Error("Gemini endpoints must use the /v1beta API root");
  if(type==="mistral"&&path!=="/v1")throw new Error("Mistral endpoints must use the /v1 API root");
}

function modeLabel(mode:AiDisclosureMode):string{
  return mode==="aggregate"?"Aggregate Only":mode==="redacted"?"Redacted Transactions":mode==="custom"?"Custom field selection":"Full Local Context";
}
