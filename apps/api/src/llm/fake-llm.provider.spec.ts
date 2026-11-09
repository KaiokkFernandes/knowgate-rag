import { FakeLlmProvider } from './fake-llm.provider';
import type { AnswerEvent } from './llm-provider';

describe('FakeLlmProvider', () => {
  it('answers with the first sentence of the first source and cites it', async () => {
    const events: AnswerEvent[] = [];
    const result = await new FakeLlmProvider().answer(
      {
        question: 'Prazo?',
        history: [],
        sources: [{ id: 'c0', title: 'Doc', text: 'O prazo é de 5 dias. Outra frase.' }],
      },
      (event) => events.push(event),
    );

    expect(events).toEqual([
      { type: 'text', text: 'De acordo com os documentos: ' },
      { type: 'text', text: 'O prazo é de 5 dias.' },
      { type: 'citation', sourceIndex: 0, citedText: 'O prazo é de 5 dias. Outra frase.' },
    ]);
    expect(result.segments).toEqual([
      { text: 'De acordo com os documentos: ', sourceIndexes: [] },
      { text: 'O prazo é de 5 dias.', sourceIndexes: [0] },
    ]);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it('costs nothing', () => {
    expect(
      new FakeLlmProvider().costUsd({
        inputTokens: 1e6,
        outputTokens: 1e6,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0);
  });
});
