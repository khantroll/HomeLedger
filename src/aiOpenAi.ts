/** Re-export OpenAI constants from the shared cloud module for focused OpenAI tests. */
export {
  OPENAI_ACCOUNT_ID,
  OPENAI_ENDPOINT,
  OPENAI_DEFAULT_MODEL,
  OPENAI_ADAPTER_CAPABILITIES,
  assertOpenAiSendConfirmation,
  presentAiAdviceText
} from "./aiCloud";
export type {CloudTransmissionGate as OpenAiTransmissionGate} from "./aiCloud";
