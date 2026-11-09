import { UnprocessableEntityException } from '@nestjs/common';
import type { DocumentSourceType } from '@knowgate/shared';
import { decodeUtf8 } from './file-type';

/**
 * A part of the document that a citation can point to: a PDF page, a Markdown section
 * (heading trail) or, for plain text, the whole file (reference: null, chunks cite paragraphs).
 */
export interface Section {
  reference: string | null;
  paragraphs: string[];
}

export async function parseDocument(type: DocumentSourceType, content: Buffer): Promise<Section[]> {
  if (type === 'PDF') return parsePdf(content);
  const text = decodeUtf8(content) ?? '';
  return type === 'MARKDOWN' ? parseMarkdown(text) : parseText(text);
}

/** Blank lines separate paragraphs; whitespace inside a paragraph is normalized. */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean);
}

export function parseText(text: string): Section[] {
  const paragraphs = splitParagraphs(text);
  return paragraphs.length > 0 ? [{ reference: null, paragraphs }] : [];
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * One section per heading; the reference is the heading trail ("Reembolso > Prazos"), so a
 * citation points to the exact subsection. Lines inside code fences are never headings.
 */
export function parseMarkdown(text: string): Section[] {
  const sections: Section[] = [];
  const trail: { level: number; title: string }[] = [];
  let lines: string[] = [];
  let reference: string | null = null;
  let inFence = false;

  const flush = () => {
    const paragraphs = splitParagraphs(lines.join('\n'));
    if (paragraphs.length > 0) sections.push({ reference, paragraphs });
    lines = [];
  };

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    const heading = inFence ? null : HEADING.exec(line);
    const [, hashes, title] = heading ?? [];
    if (hashes && title) {
      flush();
      const level = hashes.length;
      while ((trail.at(-1)?.level ?? 0) >= level) trail.pop();
      trail.push({ level, title });
      reference = trail.map((item) => item.title).join(' > ');
    }
    // The heading line stays in the content: its words help both search methods.
    lines.push(line);
  }
  flush();
  return sections;
}

/** One section per page ("p. 3"); pages without text (scans, images) are skipped. */
export async function parsePdf(content: Buffer): Promise<Section[]> {
  // unpdf is ESM-only; loaded on demand so the API (CommonJS) only pays for it on PDF uploads.
  const { extractText, getDocumentProxy } = await import('unpdf');
  let pages: string[];
  try {
    // pdf.js may transfer (detach) the buffer it receives, so it gets a copy.
    const pdf = await getDocumentProxy(new Uint8Array(content));
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch {
    throw new UnprocessableEntityException('The PDF could not be read (corrupted or encrypted)');
  }
  return pages
    .map((page, index) => ({ reference: `p. ${index + 1}`, paragraphs: splitParagraphs(page) }))
    .filter((section) => section.paragraphs.length > 0);
}
