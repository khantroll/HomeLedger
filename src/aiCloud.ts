/** Provider-neutral cloud consent and advice presentation (outside financial-domain code). */

export const OPENAI_ACCOUNT_ID="cloud:openai:default";
export const OPENAI_ENDPOINT="https://api.openai.com/v1";
export const OPENAI_DEFAULT_MODEL="gpt-4.1-mini";

export const ANTHROPIC_ACCOUNT_ID="cloud:anthropic:default";
export const ANTHROPIC_ENDPOINT="https://api.anthropic.com";
export const ANTHROPIC_DEFAULT_MODEL="claude-sonnet-4-5";

export interface CloudTransmissionGate{
  providerLabel:string;
  previewPayload:string;
  confirmed:boolean;
}

export function assertCloudSendConfirmation(gate:CloudTransmissionGate):void{
  if(!gate.previewPayload.trim())throw new Error(`Build and review the exact ${gate.providerLabel} payload before sending`);
  if(!gate.confirmed)throw new Error("Cloud transmission requires explicit per-request confirmation");
}

/** Model output is untrusted display text only — never commands or actions. */
export function presentAiAdviceText(answer:string):string{
  return answer;
}

export const CLOUD_ADAPTER_CAPABILITIES=Object.freeze({
  mayAccessRepository:false,
  mayMutateLedger:false,
  mayExecuteModelInstructions:false,
  receivesOnlyReviewedPayload:true,
  requiresExplicitConfirmation:true
});

/** @deprecated Prefer assertCloudSendConfirmation — retained as a thin OpenAI-labeled alias. */
export function assertOpenAiSendConfirmation(gate:{previewPayload:string;confirmed:boolean}):void{
  assertCloudSendConfirmation({providerLabel:"OpenAI",...gate});
}

export const OPENAI_ADAPTER_CAPABILITIES=CLOUD_ADAPTER_CAPABILITIES;
