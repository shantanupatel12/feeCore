/**
 * Minimal, dependency-free PDF 1.4 writer.
 *
 * PDF is a plain-text container format, so a valid single-font,
 * text-only document can be emitted without any external library.
 * Scope is deliberately narrow: it renders the frozen receipt
 * snapshot as paginated monospaced-ish text.
 *
 * Determinism matters more than richness here (BR-RCP-002): the same
 * snapshot must always produce byte-identical output, so nothing in
 * this file reads the clock or any live table.
 */

const PAGE_WIDTH = 595; // A4 @ 72dpi
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const FONT_SIZE = 10;
const LEADING = 16;

const LINES_PER_PAGE = Math.floor(
  (PAGE_HEIGHT - 2 * MARGIN) / LEADING,
);

/** Usable width in points, used to bound row content. */
const MAX_LINE_CHARS = 88;

/**
 * Escapes a string for a PDF literal-string object and drops
 * characters the standard Type1 encoding cannot represent, so a payer
 * name can never corrupt the byte stream or inject operators.
 */
function escapeText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // StandardEncoding covers WinAnsi printable ranges only.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function pad(text: string, width: number): string {
  const t = truncate(text, width);
  return t.padEnd(width, ' ');
}

function buildContentStream(pageLines: string[]): string {
  const parts: string[] = ['BT', `/F1 ${FONT_SIZE} Tf`];

  let y = PAGE_HEIGHT - MARGIN;
  parts.push(`1 0 0 1 ${MARGIN} ${y} Tm`);

  for (let i = 0; i < pageLines.length; i++) {
    if (i > 0) {
      y -= LEADING;
      parts.push(`1 0 0 1 ${MARGIN} ${y} Tm`);
    }
    parts.push(`(${escapeText(pageLines[i])}) Tj`);
  }

  parts.push('ET');
  return `${parts.join('\n')}\n`;
}

/**
 * Assembles the PDF byte stream, computing real xref offsets so the
 * document opens in strict readers as well as lenient ones.
 */
function assemble(chunks: string[][]): Buffer {
  const objects: string[] = [];
  const push = (body: string) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Reserve object 1 (catalog) and 2 (page tree) for forward references.
  objects.push('', '');
  const fontObj = push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );

  const pageObjNums: number[] = [];
  for (const chunk of chunks) {
    const content = buildContentStream(chunk);
    const contentObj = push(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    );
    pageObjNums.push(
      push(
        [
          '<< /Type /Page',
          `/Parent 2 0 R`,
          `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`,
          '/Resources << /Font << /F1 ' + `${fontObj} 0 R >> >>`,
          `/Contents ${contentObj} 0 R`,
          '>>',
        ].join(' '),
      ),
    );
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = [
    '<< /Type /Pages',
    `/Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}]`,
    `/Count ${pageObjNums.length}`,
    '>>',
  ].join(' ');

  // Serialise, recording each object's byte offset.
  const header = '%PDF-1.4\n';
  const parts: Buffer[] = [Buffer.from(header, 'latin1')];
  const offsets: number[] = [];
  let cursor = Buffer.byteLength(header, 'latin1');

  objects.forEach((body, i) => {
    const text = `${i + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(cursor);
    const buf = Buffer.from(text, 'latin1');
    parts.push(buf);
    cursor += buf.length;
  });

  const xrefOffset = cursor;
  const count = objects.length + 1;
  const xrefLines: string[] = ['xref', `0 ${count}`, '0000000000 65535 f '];
  for (const off of offsets) {
    xrefLines.push(`${String(off).padStart(10, '0')} 00000 n `);
  }
  const xref = `${xrefLines.join('\n')}\n`;

  const trailer = [
    'trailer',
    `<< /Size ${count} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');

  parts.push(Buffer.from(xref, 'latin1'));
  parts.push(Buffer.from(trailer, 'latin1'));

  return Buffer.concat(parts);
}

/**
 * Paginates logical lines and renders them as a PDF buffer.
 */
export function buildReceiptPdf(lines: string[]): Buffer {
  const safeLines = lines.map((l) => truncate(l, MAX_LINE_CHARS));

  const chunks: string[][] = [];
  for (let i = 0; i < safeLines.length; i += LINES_PER_PAGE) {
    chunks.push(safeLines.slice(i, i + LINES_PER_PAGE));
  }
  if (chunks.length === 0) {
    chunks.push(['']);
  }

  return assemble(chunks);
}