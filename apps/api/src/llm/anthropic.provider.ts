import Anthropic from '@anthropic-ai/sdk';
import type {
  AnswerEvent,
  AnswerRequest,
  AnswerResult,
  LlmProvider,
  LlmUsage,
} from './llm-provider';
import { SYSTEM_PROMPT } from './system-prompt';

/**
 * USD per million tokens (Anthropic pricing, checked 2026-11-09). Haiku 5.5 prices apply to
 * prompts up to 100K tokens; KnowGate prompts are a few thousand tokens. Cache writes (5-minute)
 * cost 1.25x input; cache reads as listed.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
};

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Injected in tests; the official SDK client otherwise. */
  client?: Anthropic;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly price: { input: number; output: number; cacheRead: number };

  constructor(private readonly options: AnthropicOptions) {
    const price = PRICES[options.model];
    if (!price) throw new Error(`No price configured for Claude model "${options.model}"`);
    this.model = options.model;
    this.price = price;
    // The SDK retries 408/409/429/5xx and connection errors (2 retries, backoff) by itself.
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, timeout: 60_000 });
  }

  costUsd(usage: LlmUsage): number {
    return (
      (usage.inputTokens * this.price.input +
        usage.cacheWriteTokens * this.price.input * 1.25 +
        usage.cacheReadTokens * this.price.cacheRead +
        usage.outputTokens * this.price.output) /
      1_000_000
    );
  }

  async answer(
    request: AnswerRequest,
    onEvent: (event: AnswerEvent) => void,
  ): Promise<AnswerResult> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: this.options.maxTokens,
        // Fixed prompt with a cache breakpoint: identical prefix on every request.
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: this.options.effort },
        messages: [
          ...request.history.map((turn) => ({ role: turn.role, content: turn.content })),
          {
            role: 'user',
            // Native citations: each chunk is a search_result block; Claude cites it by index.
            content: [
              ...request.sources.map((source): Anthropic.SearchResultBlockParam => ({
                type: 'search_result',
                source: `knowgate://chunks/${source.id}`,
                title: source.title,
                content: [{ type: 'text', text: source.text }],
                citations: { enabled: true },
              })),
              { type: 'text', text: request.question },
            ],
          },
        ],
      },
      { signal: request.signal },
    );

    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'text_delta') {
        onEvent({ type: 'text', text: event.delta.text });
      } else if (
        event.delta.type === 'citations_delta' &&
        event.delta.citation.type === 'search_result_location'
      ) {
        onEvent({
          type: 'citation',
          sourceIndex: event.delta.citation.search_result_index,
          citedText: event.delta.citation.cited_text,
        });
      }
    }

    const message = await stream.finalMessage();
    const segments = message.content.flatMap(
      (block) =>
        block.type === 'text'
          ? [
              {
                text: block.text,
                sourceIndexes: [
                  ...new Set(
                    (block.citations ?? []).flatMap((c) =>
                      c.type === 'search_result_location' ? [c.search_result_index] : [],
                    ),
                  ),
                ],
              },
            ]
          : [], // thinking blocks (adaptive thinking) are not part of the answer
    );
    return {
      segments,
      stopReason: message.stop_reason,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
