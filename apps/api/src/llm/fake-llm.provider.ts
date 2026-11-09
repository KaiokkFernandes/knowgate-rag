import { estimateTokens } from '../documents/ingestion/chunker';
import type {
  AnswerEvent,
  AnswerRequest,
  AnswerResult,
  LlmProvider,
  LlmUsage,
} from './llm-provider';

/**
 * Deterministic, offline stand-in for Claude (tests and local development): answers with the
 * first sentence of the first source and cites it, streaming in two pieces like the real API.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly model = 'fake-llm';

  costUsd(_usage: LlmUsage): number {
    return 0;
  }

  answer(request: AnswerRequest, onEvent: (event: AnswerEvent) => void): Promise<AnswerResult> {
    const first = request.sources[0];
    const sentence = first ? (first.text.split(/(?<=[.!?])\s/)[0] ?? first.text) : '';
    const intro = 'De acordo com os documentos: ';
    onEvent({ type: 'text', text: intro });
    if (first) {
      onEvent({ type: 'text', text: sentence });
      onEvent({ type: 'citation', sourceIndex: 0, citedText: first.text });
    }
    const prompt = [request.question, ...request.sources.map((s) => s.text)].join('\n');
    return Promise.resolve({
      segments: [
        { text: intro, sourceIndexes: [] },
        ...(first ? [{ text: sentence, sourceIndexes: [0] }] : []),
      ],
      stopReason: 'end_turn',
      usage: {
        inputTokens: estimateTokens(prompt),
        outputTokens: estimateTokens(intro + sentence),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    });
  }
}
