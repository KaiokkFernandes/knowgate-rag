import type { Section } from './parsers';

export interface ChunkOptions {
  /** Upper bound for a chunk, in estimated tokens (the overlap is included). */
  targetTokens: number;
  /** Tokens repeated from the end of the previous chunk of the same section. */
  overlapTokens: number;
}

export interface ChunkDraft {
  position: number;
  content: string;
  reference: string | null;
  tokenCount: number;
}

/**
 * Token estimate: ~4 characters per token for Portuguese and English prose. Good enough to
 * size chunks; the exact count of embedded tokens comes from the embeddings API usage.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Unit {
  text: string;
  tokens: number;
  /** Index of the source paragraph inside the section (pieces of one paragraph share it). */
  paragraph: number;
}

/**
 * Structure-aware chunking. Paragraphs are packed into chunks up to `targetTokens`; a chunk
 * never crosses a section (page or heading), so its reference stays exact. A paragraph that is
 * too long is split by sentences, and a sentence that is too long by words. Consecutive chunks
 * of a section share `overlapTokens` of whole units, so an idea cut at a boundary still
 * appears complete in one of them.
 */
export function chunkSections(sections: Section[], options: ChunkOptions): ChunkDraft[] {
  if (options.overlapTokens >= options.targetTokens) {
    throw new Error('overlapTokens must be smaller than targetTokens');
  }
  const chunks: ChunkDraft[] = [];

  for (const section of sections) {
    const units = section.paragraphs.flatMap((paragraph, index) =>
      splitParagraph(paragraph, options.targetTokens).map((text) => ({
        text,
        tokens: estimateTokens(text),
        paragraph: index,
      })),
    );

    let current: Unit[] = [];
    const emit = () => {
      const content = joinUnits(current);
      chunks.push({
        position: chunks.length,
        content,
        reference: section.reference ?? paragraphReference(current),
        tokenCount: estimateTokens(content),
      });
    };

    for (const unit of units) {
      if (current.length > 0 && sumTokens(current) + unit.tokens > options.targetTokens) {
        emit();
        current = overlapTail(current, options.overlapTokens);
        // The overlap gives way if it would push the next chunk over the target.
        while (current.length > 0 && sumTokens(current) + unit.tokens > options.targetTokens) {
          current.shift();
        }
      }
      current.push(unit);
    }
    if (current.length > 0) emit();
  }
  return chunks;
}

/** The last whole units of a chunk whose total fits in `overlapTokens`. */
function overlapTail(units: Unit[], overlapTokens: number): Unit[] {
  const tail: Unit[] = [];
  let tokens = 0;
  for (const unit of [...units].reverse()) {
    if (tokens + unit.tokens > overlapTokens) break;
    tokens += unit.tokens;
    tail.unshift(unit);
  }
  return tail;
}

function splitParagraph(paragraph: string, maxTokens: number): string[] {
  if (estimateTokens(paragraph) <= maxTokens) return [paragraph];
  // Sentence boundary: punctuation followed by whitespace.
  return paragraph
    .split(/(?<=[.!?…])\s+/)
    .flatMap((sentence) =>
      estimateTokens(sentence) <= maxTokens ? [sentence] : splitWords(sentence, maxTokens),
    );
}

function splitWords(sentence: string, maxTokens: number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const word of sentence.split(/\s+/)) {
    const candidate = piece ? `${piece} ${word}` : word;
    if (piece && estimateTokens(candidate) > maxTokens) {
      pieces.push(piece);
      piece = word;
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Pieces of the same paragraph are joined by a space, different paragraphs by a blank line. */
function joinUnits(units: Unit[]): string {
  let text = '';
  let previous: Unit | undefined;
  for (const unit of units) {
    if (previous) text += unit.paragraph === previous.paragraph ? ' ' : '\n\n';
    text += unit.text;
    previous = unit;
  }
  return text;
}

function sumTokens(units: Unit[]): number {
  return units.reduce((total, unit) => total + unit.tokens, 0);
}

/** Plain text has no pages or headings: the chunk cites its paragraph range. */
function paragraphReference(units: Unit[]): string {
  const first = (units.at(0)?.paragraph ?? 0) + 1;
  const last = (units.at(-1)?.paragraph ?? 0) + 1;
  return first === last ? `parágrafo ${first}` : `parágrafos ${first}–${last}`;
}
