/**
 * Builds a minimal, valid PDF in memory: one page per item, each line drawn with Helvetica
 * (WinAnsi encoding, so Portuguese accents work). An empty page has no text, like a scan.
 * Generating it keeps binary fixtures out of git and lets each test choose its own text.
 */
export function buildPdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1; // 1-based object number

  const catalog = add(''); // filled in once the page tree exists
  const pageTree = add('');
  const font = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );

  const pageRefs = pages.map((lines) => {
    const text = lines.map((line) => `(${escapePdfString(line)}) Tj T*`).join(' ');
    const stream = lines.length > 0 ? `BT /F1 12 Tf 14 TL 72 720 Td ${text} ET` : '';
    const contents = add(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
    return add(
      `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`,
    );
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] =
    `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = Buffer.byteLength(pdf, 'latin1');
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function escapePdfString(text: string): string {
  return text.replace(/[\\()]/g, (char) => `\\${char}`);
}
