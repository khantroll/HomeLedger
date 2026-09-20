/** OpenAI cloud transmission helpers kept outside financial-domain code. */

export const OPENAI_ACCOUNT_ID="cloud:openai:default";
export const OPENAI_ENDPOINT="https://api.openai.com/v1";
export const OPENAI_DEFAULT_MODEL="gpt-4.1-mini";

export interface OpenAiTransmissionGate{
  previewPayload:string;
  confirmed:boolean;
}

export function assertOpenAiSendConfirmation(gate:OpenAiTransmissionGate):void{
  if(!gate.previewPayload.trim())throw new Error("Build and review the exact OpenAI payload before sending");
  if(!gate.confirmed)throw new Error("Cloud transmission requires explicit per-request confirmation");
}

/** Model output is untrusted display text only — never commands or actions. */
export function presentAiAdviceText(answer:string):string{
  return answer;
}

export const OPENAI_ADAPTER_CAPABILITIES=Object.freeze({
  mayAccessRepository:false,
  mayMutateLedger:false,
  mayExecuteModelInstructions:false,
  receivesOnlyReviewedPayload:true,
  requiresExplicitConfirmation:true
});
