import { parseMoney, type ImportTransactionRow, type Transaction } from "./domain";

export interface ParsedTable { headers: string[]; rows: string[][]; delimiter: "," | "\t"; }
export interface ColumnMapping { date: number; payee: number; amount: number; debit: number; credit: number; }
export interface PreviewRow extends ImportTransactionRow { sourceRow: number; duplicate: boolean; error?: string; }

export function parseDelimited(text: string): ParsedTable {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter: "," | "\t" = countOutsideQuotes(firstLine, "\t") > countOutsideQuotes(firstLine, ",") ? "\t" : ",";
  const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === delimiter) { row.push(field.trim()); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[i + 1] === "\n") i++;
      row.push(field.trim()); field = "";
      if (row.some(value => value !== "")) records.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(value => value !== "")) records.push(row);
  if (quoted) throw new Error("The statement contains an unclosed quoted value");
  if (records.length < 2) throw new Error("The statement needs a header and at least one transaction row");
  const headers = records[0].map((value, index) => value || `Column ${index + 1}`);
  return { headers, rows: records.slice(1), delimiter };
}

function countOutsideQuotes(value: string, target: string): number {
  let quoted = false, count = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"' && value[i + 1] === '"') i++;
    else if (value[i] === '"') quoted = !quoted;
    else if (!quoted && value[i] === target) count++;
  }
  return count;
}

export function suggestMapping(headers: string[]): ColumnMapping {
  const find = (...patterns: RegExp[]) => headers.findIndex(header => patterns.some(pattern => pattern.test(header.toLowerCase())));
  return {
    date: find(/^date$/, /posted.*date/, /transaction.*date/),
    payee: find(/^payee$/, /description/, /merchant/, /^name$/, /details/),
    amount: find(/^amount$/, /transaction.*amount/),
    debit: find(/^debit$/, /withdrawal/, /money out/, /charge/),
    credit: find(/^credit$/, /deposit/, /money in/)
  };
}

export function normalizeDate(value: string): string {
  const trimmed = value.trim();
  let year: number, month: number, day: number;
  let match = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) [, year, month, day] = match.map(Number);
  else {
    match = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
    if (!match) throw new Error(`Unsupported date: ${value}`);
    month = Number(match[1]); day = Number(match[2]); year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) throw new Error(`Invalid date: ${value}`);
  return `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

export function parseStatementMoney(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Missing amount");
  const negative = /^\(.*\)$/.test(trimmed) || /-$/.test(trimmed) || /\bDR$/i.test(trimmed);
  const cleaned = trimmed.replace(/[()]/g, "").replace(/-$/, "").replace(/\s*(CR|DR)$/i, "").trim();
  const amount = parseMoney(cleaned);
  return negative ? -Math.abs(amount) : amount;
}

export function buildPreview(table: ParsedTable, mapping: ColumnMapping, existing: Transaction[]): PreviewRow[] {
  const existingKeys = new Set(existing.map(item => transactionDuplicateKey(item.postedDate, item.payee, item.amountMinor)));
  const seen = new Set<string>();
  return table.rows.map((row, index) => {
    try {
      if (mapping.date < 0 || mapping.payee < 0) throw new Error("Map the date and description columns");
      if (mapping.amount < 0 && mapping.debit < 0 && mapping.credit < 0) throw new Error("Map an amount column or debit/credit columns");
      const postedDate = normalizeDate(row[mapping.date] ?? "");
      const payee = (row[mapping.payee] ?? "").trim();
      if (!payee) throw new Error("Missing description/payee");
      let amountMinor: number;
      if (mapping.amount >= 0) amountMinor = parseStatementMoney(row[mapping.amount] ?? "");
      else {
        const debit = (row[mapping.debit] ?? "").trim();
        const credit = (row[mapping.credit] ?? "").trim();
        if (debit && credit) throw new Error("Both debit and credit contain values");
        if (!debit && !credit) throw new Error("Missing debit/credit amount");
        amountMinor = debit ? -Math.abs(parseStatementMoney(debit)) : Math.abs(parseStatementMoney(credit));
      }
      const key = transactionDuplicateKey(postedDate, payee, amountMinor);
      const duplicate = existingKeys.has(key) || seen.has(key);
      seen.add(key);
      return { sourceRow: index + 2, postedDate, payee, amountMinor, duplicate };
    } catch (reason) {
      return { sourceRow: index + 2, postedDate: "", payee: row[mapping.payee] ?? "", amountMinor: 0, duplicate: false, error: reason instanceof Error ? reason.message : String(reason) };
    }
  });
}

export function transactionDuplicateKey(date: string, payee: string, amountMinor: number): string {
  return `${date}|${payee.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${amountMinor}`;
}
