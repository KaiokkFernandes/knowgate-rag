import { UnprocessableEntityException } from '@nestjs/common';
import { buildPdf } from '../../../test/fixtures/build-pdf';
import { parseDocument, parseMarkdown, parseText, splitParagraphs } from './parsers';

describe('splitParagraphs', () => {
  it('splits on blank lines, normalizes whitespace and line endings', () => {
    expect(splitParagraphs('  um   dois \r\ntrês\r\n\r\n\n  quatro  \n \n')).toEqual([
      'um dois\ntrês',
      'quatro',
    ]);
  });
});

describe('parseText', () => {
  it('returns one section without reference', () => {
    expect(parseText('a\n\nb')).toEqual([{ reference: null, paragraphs: ['a', 'b'] }]);
    expect(parseText(' \n\n ')).toEqual([]);
  });
});

describe('parseMarkdown', () => {
  it('creates one section per heading with the heading trail as reference', () => {
    const sections = parseMarkdown(
      [
        'Intro sem título.',
        '# Reembolso',
        'Regras gerais.',
        '## Prazos ##',
        'Até 30 dias.',
        '## Limites',
        'R$ 500 por mês.',
        '# Viagens',
        'Hospedagem.',
      ].join('\n'),
    );
    expect(sections.map((s) => s.reference)).toEqual([
      null,
      'Reembolso',
      'Reembolso > Prazos',
      'Reembolso > Limites',
      'Viagens',
    ]);
    // The heading line stays in the content.
    expect(sections[2]?.paragraphs).toEqual(['## Prazos ##\nAté 30 dias.']);
  });

  it('ignores "#" lines inside code fences', () => {
    const sections = parseMarkdown('# Script\n```bash\n# not a heading\necho ok\n```\nfim');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.reference).toBe('Script');
  });
});

describe('parseDocument (PDF)', () => {
  it('returns one section per page and skips pages without text', async () => {
    const pdf = buildPdf([['Política de home office', 'Regra 1'], [], ['Página três']]);
    const sections = await parseDocument('PDF', pdf);
    expect(sections.map((s) => s.reference)).toEqual(['p. 1', 'p. 3']);
    expect(sections[0]?.paragraphs.join(' ')).toContain('Política de home office');
    expect(sections[1]?.paragraphs.join(' ')).toContain('Página três');
  });

  it('rejects a corrupted PDF with 422', async () => {
    await expect(parseDocument('PDF', Buffer.from('%PDF-1.4 garbage'))).rejects.toThrow(
      UnprocessableEntityException,
    );
  });
});
