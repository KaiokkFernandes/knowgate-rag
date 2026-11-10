export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** A retrieved chunk handed to the model as citable data. */
export interface AnswerSource {
  /** Stable identifier echoed back in citations (the chunk id). */
  id: string;
  title: string;
  text: string;
}

export interface AnswerRequest {
  question: string;
  sources: AnswerSource[];
  /** Earlier turns of the conversation, plain text, oldest first. */
  history: { role: 'user' | 'assistant'; content: string }[];
  signal?: AbortSignal;
}

/** Streamed to the client as it is generated. */
export type AnswerEvent =
  { type: 'text'; text: string } | { type: 'citation'; sourceIndex: number; citedText: string };

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AnswerResult {
  /** The answer split where citations change; each part lists the sources it relies on. */
  segments: { text: string; sourceIndexes: number[] }[];
  stopReason: string | null;
  usage: LlmUsage;
}

/** Claude in production, a deterministic fake in tests: tests never call a paid API. */
export interface LlmProvider {
  readonly model: string;
  costUsd(usage: LlmUsage): number;
  answer(request: AnswerRequest, onEvent: (event: AnswerEvent) => void): Promise<AnswerResult>;
}
