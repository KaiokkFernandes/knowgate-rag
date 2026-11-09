import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { DocumentSourceType } from '@knowgate/shared';

const EXTENSIONS: Record<string, DocumentSourceType> = {
  '.pdf': 'PDF',
  '.md': 'MARKDOWN',
  '.markdown': 'MARKDOWN',
  '.txt': 'TXT',
};

const PDF_MAGIC = Buffer.from('%PDF-');

/**
 * Decides the document type from the extension AND the content. The client's
 * Content-Type and extension are never trusted alone: a renamed binary is rejected here.
 */
export function detectSourceType(fileName: string, content: Buffer): DocumentSourceType {
  const dot = fileName.lastIndexOf('.');
  const sourceType = dot === -1 ? undefined : EXTENSIONS[fileName.slice(dot).toLowerCase()];
  if (!sourceType) {
    throw new UnsupportedMediaTypeException('Only PDF, Markdown (.md) and text (.txt) files');
  }

  const matches =
    sourceType === 'PDF'
      ? content.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
      : isUtf8Text(content);
  if (!matches) {
    throw new UnsupportedMediaTypeException('File content does not match its extension');
  }
  return sourceType;
}

/** Valid UTF-8 without NUL bytes (binary files almost always contain NUL). */
function isUtf8Text(content: Buffer): boolean {
  return content.indexOf(0) === -1 && decodeUtf8(content) !== undefined;
}

/** Strict UTF-8 decoding (invalid sequences fail instead of becoming U+FFFD); BOM removed. */
export function decodeUtf8(content: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(content);
  } catch {
    return undefined;
  }
}
