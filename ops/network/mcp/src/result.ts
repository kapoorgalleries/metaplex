import { CHARACTER_LIMIT, STREAM_LIMIT } from './constants.js';

interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolResult {
  [key: string]: unknown;
  content: TextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Cut a long text and say so, so the model knows to narrow the request. */
export function clip(text: string, limit = CHARACTER_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[truncated: ${text.length - limit} more characters. Narrow the request (a filter, a host, fewer tail lines) to see the rest.]`;
}

export function clipStream(text: string): string {
  return clip(text, STREAM_LIMIT);
}

export function ok(text: string, structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: clip(text) }], structuredContent: structured };
}

export function fail(message: string): ToolResult {
  return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] };
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Minimal CSV reader for the kit's own files: handles double-quoted fields (PowerShell's Export-Csv) and CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift()?.map((h) => h.trim()) ?? [];
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Rows of a GitHub-flavoured Markdown table (the first table in the text). */
export function parseMdTable(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return [];
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  const header = cells(lines[0] ?? '');
  return lines
    .slice(1)
    .filter((l) => !/^\|?\s*-{2,}/.test(l.trim()) && !/^\|(\s*-+\s*\|)+\s*$/.test(l.trim()))
    .map((l) => Object.fromEntries(header.map((h, i) => [h, cells(l)[i] ?? ''])));
}

export function mdTable(rows: ReadonlyArray<object>, columns: string[]): string {
  if (!rows.length) return '(none)';
  const head = `| ${columns.join(' | ')} |\n|${columns.map(() => '---').join('|')}|`;
  const body = rows
    .map((r) => `| ${columns.map((c) => String((r as Record<string, unknown>)[c] ?? '')).join(' | ')} |`)
    .join('\n');
  return `${head}\n${body}`;
}
