import { chunkSections, estimateTokens } from './chunker';
import type { Section } from './parsers';

/** A paragraph of roughly `tokens` estimated tokens, made of numbered sentences. */
function paragraph(tokens: number, tag: string): string {
  const sentences: string[] = [];
  let i = 0;
  while (estimateTokens(sentences.join(' ')) < tokens) sentences.push(`${tag} frase ${i++}.`);
  return sentences.join(' ');
}

const options = { targetTokens: 100, overlapTokens: 20 };

describe('chunkSections', () => {
  it('packs small paragraphs of a section into one chunk', () => {
    const chunks = chunkSections([{ reference: 'p. 1', paragraphs: ['Um.', 'Dois.'] }], options);
    expect(chunks).toEqual([
      {
        position: 0,
        content: 'Um.\n\nDois.',
        reference: 'p. 1',
        tokenCount: estimateTokens('Um.\n\nDois.'),
      },
    ]);
  });

  it('never crosses a section, so every chunk keeps an exact reference', () => {
    const sections: Section[] = [
      { reference: 'p. 1', paragraphs: ['Página um.'] },
      { reference: 'p. 2', paragraphs: ['Página dois.'] },
    ];
    expect(chunkSections(sections, options).map((c) => [c.reference, c.content])).toEqual([
      ['p. 1', 'Página um.'],
      ['p. 2', 'Página dois.'],
    ]);
  });

  it('respects the target size and numbers positions across sections', () => {
    const sections: Section[] = [
      { reference: 'A', paragraphs: [paragraph(60, 'a'), paragraph(60, 'b'), paragraph(60, 'c')] },
      { reference: 'B', paragraphs: [paragraph(250, 'd')] },
    ];
    const chunks = chunkSections(sections, options);
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.map((c) => c.position)).toEqual(chunks.map((_, i) => i));
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(options.targetTokens);
  });

  it('repeats the end of the previous chunk (overlap) inside the same section', () => {
    const chunks = chunkSections([{ reference: 'A', paragraphs: [paragraph(300, 'x')] }], options);
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      const previous = chunks[i - 1]?.content ?? '';
      const current = chunks[i]?.content ?? '';
      // The chunk starts with whole sentences that closed the previous one...
      const firstSentence = current.slice(0, current.indexOf('.') + 1);
      const lastSentence = previous.slice(previous.lastIndexOf(' x ') + 1);
      expect(previous.endsWith(firstSentence) || previous.includes(`${firstSentence} `)).toBe(true);
      expect(current).toContain(lastSentence);
      // ...and the repeated part stays within the overlap budget.
      const repeated = current.slice(0, current.indexOf(lastSentence) + lastSentence.length);
      expect(estimateTokens(repeated)).toBeLessThanOrEqual(options.overlapTokens);
    }
  });

  it('splits a sentence without punctuation by words', () => {
    const words = Array.from({ length: 200 }, (_, i) => `palavra${i}`).join(' ');
    const chunks = chunkSections([{ reference: null, paragraphs: [words] }], {
      targetTokens: 100,
      overlapTokens: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // No words lost or duplicated without overlap.
    expect(chunks.map((c) => c.content).join(' ')).toBe(words);
  });

  it('cites paragraph ranges for plain text', () => {
    const chunks = chunkSections(
      [{ reference: null, paragraphs: ['Um.', 'Dois.', paragraph(150, 'longo')] }],
      { targetTokens: 100, overlapTokens: 0 },
    );
    // The long paragraph is split into sentences; its first ones still fit in the first chunk.
    expect(chunks[0]?.reference).toBe('parágrafos 1–3');
    expect(chunks.at(-1)?.reference).toBe('parágrafo 3');
  });

  it('rejects an overlap that is not smaller than the target', () => {
    expect(() => chunkSections([], { targetTokens: 50, overlapTokens: 50 })).toThrow();
  });
});
