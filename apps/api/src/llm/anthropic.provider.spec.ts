import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicLlmProvider } from './anthropic.provider';
import type { AnswerEvent } from './llm-provider';
import { SYSTEM_PROMPT } from './system-prompt';

const citation = (index: number, text: string) => ({
  type: 'search_result_location' as const,
  search_result_index: index,
  cited_text: text,
  source: `knowgate://chunks/c${index}`,
  title: `Doc ${index}`,
  start_block_index: 0,
  end_block_index: 1,
});

/** Stream events and final message shaped like the Messages API streaming response. */
const EVENTS = [
  { type: 'message_start' },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'O reembolso ' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'leva 5 dias.' } },
  {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'citations_delta', citation: citation(1, 'até 5 dias úteis') },
  },
  { type: 'message_stop' },
];
const FINAL_MESSAGE = {
  content: [
    { type: 'thinking', thinking: 'hmm', signature: 'sig' },
    { type: 'text', text: 'Resposta: ', citations: null },
    {
      type: 'text',
      text: 'O reembolso leva 5 dias.',
      citations: [citation(1, 'até 5 dias úteis'), citation(1, 'dias úteis'), citation(0, 'x')],
    },
  ],
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_input_tokens: 600,
    cache_creation_input_tokens: null,
  },
};

function setup(model = 'claude-haiku-5-5') {
  const calls: { params: Anthropic.MessageCreateParams; options: unknown }[] = [];
  const client = {
    messages: {
      stream: (params: Anthropic.MessageCreateParams, options: unknown) => {
        calls.push({ params, options });
        return {
          async *[Symbol.asyncIterator]() {
            for (const event of EVENTS) yield await Promise.resolve(event);
          },
          finalMessage: () => Promise.resolve(FINAL_MESSAGE),
        };
      },
    },
  } as unknown as Anthropic;
  const provider = new AnthropicLlmProvider({
    apiKey: 'test-key',
    model,
    maxTokens: 1024,
    effort: 'low',
    client,
  });
  return { provider, calls };
}

describe('AnthropicLlmProvider', () => {
  const request = {
    question: 'Quanto tempo leva o reembolso?',
    history: [
      { role: 'user' as const, content: 'Oi' },
      { role: 'assistant' as const, content: 'Olá!' },
    ],
    sources: [
      { id: 'c0', title: 'Política de viagens — p. 1', text: 'Viagens precisam de aprovação.' },
      {
        id: 'c1',
        title: 'Política de reembolso — Seção 2',
        text: 'Pagamento em até 5 dias úteis.',
      },
    ],
  };

  it('sends a cached system prompt, the history and the chunks as citable search results', async () => {
    const { provider, calls } = setup();
    const signal = new AbortController().signal;

    await provider.answer({ ...request, signal }, () => undefined);

    expect(calls).toHaveLength(1);
    const { params, options } = calls[0]!;
    expect(options).toEqual({ signal });
    expect(params).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low' },
    });
    expect(params.messages.slice(0, 2)).toEqual(request.history);
    expect(params.messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'search_result',
          source: 'knowgate://chunks/c0',
          title: 'Política de viagens — p. 1',
          content: [{ type: 'text', text: 'Viagens precisam de aprovação.' }],
          citations: { enabled: true },
        },
        {
          type: 'search_result',
          source: 'knowgate://chunks/c1',
          title: 'Política de reembolso — Seção 2',
          content: [{ type: 'text', text: 'Pagamento em até 5 dias úteis.' }],
          citations: { enabled: true },
        },
        // The question comes after the documents (long context first, query last).
        { type: 'text', text: 'Quanto tempo leva o reembolso?' },
      ],
    });
  });

  it('streams text and citations, skipping thinking', async () => {
    const { provider } = setup();
    const events: AnswerEvent[] = [];

    await provider.answer(request, (event) => events.push(event));

    expect(events).toEqual([
      { type: 'text', text: 'O reembolso ' },
      { type: 'text', text: 'leva 5 dias.' },
      { type: 'citation', sourceIndex: 1, citedText: 'até 5 dias úteis' },
    ]);
  });

  it('returns text segments with their distinct cited sources and the usage', async () => {
    const { provider } = setup();

    const result = await provider.answer(request, () => undefined);

    expect(result).toEqual({
      segments: [
        { text: 'Resposta: ', sourceIndexes: [] },
        { text: 'O reembolso leva 5 dias.', sourceIndexes: [1, 0] },
      ],
      stopReason: 'end_turn',
      usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 600, cacheWriteTokens: 0 },
    });
  });

  it('prices uncached input, cache writes (1.25x), cache reads and output', () => {
    const { provider } = setup();
    const usage = {
      inputTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      outputTokens: 1_000_000,
    };
    expect(provider.costUsd(usage)).toBeCloseTo(0.1 + 0.125 + 0.01 + 0.5, 10);
    expect(setup('claude-opus-5-5').provider.costUsd(usage)).toBeCloseTo(4 + 5 + 0.2 + 20, 10);
  });

  it('refuses a model without a configured price', () => {
    expect(() => setup('claude-unknown')).toThrow(/No price/);
  });
});
