import { Readable } from 'stream';

/**
 * Minimal RFC 4180 CSV writer.
 *
 * `csv-parser` is already a dependency, but it only *reads* CSV, and no
 * writer package is present. Adding a dependency for a dozen lines of
 * escaping is not justified, so the writer is implemented here. `csv-parser`
 * is used by the test suite to read the output back, which proves the
 * escaping round-trips.
 */

/** True when a field must be quoted per RFC 4180. */
function needsQuoting(text: string): boolean {
  return /[",\r\n]/.test(text);
}

/**
 * Escapes one field: empty for null/undefined, and double-quoted (with inner
 * quotes doubled) when it contains a comma, quote, CR or LF.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  return needsQuoting(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Joins one record into a CSV line without a line terminator. */
export function csvLine(values: readonly unknown[]): string {
  return values.map(escapeCsvField).join(',');
}

/**
 * Builds a readable stream of `header` followed by every row from `rows`.
 *
 * Rows are pulled lazily, so a consumer that streams the result to the
 * response never materialises the whole dataset. Line terminator is CRLF as
 * RFC 4180 specifies.
 */
export function csvStream(
  header: readonly unknown[],
  rows: AsyncIterable<readonly unknown[]>,
): Readable {
  return Readable.from(
    (async function* () {
      yield `${csvLine(header)}\r\n`;
      for await (const row of rows) {
        yield `${csvLine(row)}\r\n`;
      }
    })(),
  );
}
