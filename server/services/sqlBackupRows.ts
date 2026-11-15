// Keep gzip input byte-sized rather than making an asynchronous write per row.
// The caller supplies already server-quoted values; never parse/re-encode them.
export const SQL_CHUNK_BYTES = 64 * 1024;
const MAX_INSERT_ROWS = 100;

export function* sqlInsertChunks(
  tableSql: string,
  columnsSql: string,
  rows: ReadonlyArray<{ values_sql: string }>,
): Generator<string> {
  const prefix = columnsSql
    ? `INSERT INTO ${tableSql} (${columnsSql}) OVERRIDING SYSTEM VALUE VALUES `
    : "";
  const prefixBytes = Buffer.byteLength(prefix);
  let parts: string[] = [];
  let bytes = prefixBytes + 2;
  const flush = () => columnsSql ? `${prefix}${parts.join(",")};\n` : parts.join("");
  for (const row of rows) {
    const part = columnsSql ? `(${row.values_sql})` : `INSERT INTO ${tableSql} DEFAULT VALUES;\n`;
    const size = Buffer.byteLength(part) + (columnsSql && parts.length ? 1 : 0);
    if (parts.length && (bytes + size > SQL_CHUNK_BYTES || parts.length >= MAX_INSERT_ROWS)) {
      yield flush();
      parts = [];
      bytes = prefixBytes + 2;
    }
    parts.push(part);
    bytes += size;
  }
  if (parts.length) yield flush();
}
