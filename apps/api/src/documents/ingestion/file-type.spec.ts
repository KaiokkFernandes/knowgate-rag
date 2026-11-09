import { UnsupportedMediaTypeException } from '@nestjs/common';
import { buildPdf } from '../../../test/fixtures/build-pdf';
import { detectSourceType } from './file-type';

describe('detectSourceType', () => {
  it('accepts PDF, Markdown and text by extension and content', () => {
    expect(detectSourceType('Manual.PDF', buildPdf([['Ola']]))).toBe('PDF');
    expect(detectSourceType('guia.md', Buffer.from('# Guia'))).toBe('MARKDOWN');
    expect(detectSourceType('guia.markdown', Buffer.from('# Guia'))).toBe('MARKDOWN');
    expect(detectSourceType('notas.txt', Buffer.from('Política de reembolso'))).toBe('TXT');
  });

  it('rejects other extensions', () => {
    expect(() => detectSourceType('planilha.xlsx', Buffer.from('x'))).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => detectSourceType('sem-extensao', Buffer.from('x'))).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it('rejects content that does not match the extension', () => {
    // A binary renamed to .pdf, a PDF renamed to .txt, invalid UTF-8 renamed to .md.
    expect(() => detectSourceType('virus.pdf', Buffer.from('MZ\x90\x00binary'))).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => detectSourceType('doc.txt', Buffer.from('%PDF-1.4\n\x00\x01'))).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => detectSourceType('doc.md', Buffer.from([0xc3, 0x28]))).toThrow(
      UnsupportedMediaTypeException,
    );
  });
});
