import { parseMoney, type ImportTransactionRow, type Transaction } from "./domain";
import { classifyDuplicates, type DuplicateMatch } from "./duplicateDetection";

export interface ParsedTable { headers: string[]; rows: string[][]; delimiter: "," | "\t" | ";"; }
export interface ColumnMapping { date: number; payee: number; amount: number; debit: number; credit: number; }
export type StatementDateOrder="mdy"|"dmy";
export type StatementNumberFormat="dot"|"comma";
export interface DelimitedParsingOptions { dateOrder:StatementDateOrder; numberFormat:StatementNumberFormat; }
export interface PreviewRow extends ImportTransactionRow { sourceRow: number; duplicate?: DuplicateMatch; error?: string; }

export function parseDelimited(text: string): ParsedTable {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = ([",","\t",";"] as const).reduce((best,candidate)=>countOutsideQuotes(firstLine,candidate)>countOutsideQuotes(firstLine,best)?candidate:best,"," as ","|"\t"|";");
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

export function headerSignature(headers:string[]):string{return headers.map(header=>header.toLowerCase().replace(/\s+/g," ").trim()).join("\u001f");}

export function suggestParsingOptions(table:ParsedTable,mapping:ColumnMapping):DelimitedParsingOptions{
  const dates=mapping.date>=0?table.rows.map(row=>row[mapping.date]??""):[];
  let dateOrder:StatementDateOrder="mdy";
  for(const value of dates){const match=value.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/]/);if(!match)continue;const first=Number(match[1]),second=Number(match[2]);if(first>12){dateOrder="dmy";break;}if(second>12){dateOrder="mdy";break;}}
  const amountIndex=mapping.amount>=0?mapping.amount:mapping.debit>=0?mapping.debit:mapping.credit;
  const amounts=amountIndex>=0?table.rows.map(row=>row[amountIndex]??""):[];
  let numberFormat:StatementNumberFormat="dot";
  for(const value of amounts){const cleaned=value.replace(/\s/g,"");const comma=cleaned.lastIndexOf(","),dot=cleaned.lastIndexOf(".");if(comma>=0&&dot>=0){numberFormat=comma>dot?"comma":"dot";break;}if(comma>=0&&/^\d{1,2}(?:\D.*)?$/.test(cleaned.slice(comma+1))){numberFormat="comma";break;}}
  return{dateOrder,numberFormat};
}

export function normalizeDate(value: string,dateOrder:StatementDateOrder="mdy"): string {
  const trimmed = value.trim();
  let year: number, month: number, day: number;
  let match = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) [, year, month, day] = match.map(Number);
  else {
    match = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
    if (!match) throw new Error(`Unsupported date: ${value}`);
    const first=Number(match[1]),second=Number(match[2]);
    if(dateOrder==="dmy"){day=first;month=second;}else{month=first;day=second;}year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) throw new Error(`Invalid date: ${value}`);
  return `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

export function parseStatementMoney(value: string,numberFormat:StatementNumberFormat="dot"): number {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Missing amount");
  const negative = /^\(.*\)$/.test(trimmed) || /-/.test(trimmed) || /\bDR$/i.test(trimmed);
  let cleaned = trimmed.replace(/\s*(CR|DR)$/i, "").replace(/[\s\u00a0'’]/g,"").replace(/[^\d.,]/g,"");
  if(numberFormat==="comma")cleaned=cleaned.replaceAll(".","").replace(",",".");else cleaned=cleaned.replaceAll(",","");
  const amount = parseMoney(cleaned);
  return negative ? -Math.abs(amount) : amount;
}

export function buildPreview(table: ParsedTable, mapping: ColumnMapping, existing: Transaction[],options:DelimitedParsingOptions={dateOrder:"mdy",numberFormat:"dot"}): PreviewRow[] {
  const rows=table.rows.map((row, index):PreviewRow => {
    try {
      if (mapping.date < 0 || mapping.payee < 0) throw new Error("Map the date and description columns");
      if (mapping.amount < 0 && mapping.debit < 0 && mapping.credit < 0) throw new Error("Map an amount column or debit/credit columns");
      const postedDate = normalizeDate(row[mapping.date] ?? "",options.dateOrder);
      const payee = (row[mapping.payee] ?? "").trim();
      if (!payee) throw new Error("Missing description/payee");
      let amountMinor: number;
      if (mapping.amount >= 0) amountMinor = parseStatementMoney(row[mapping.amount] ?? "",options.numberFormat);
      else {
        const debit = (row[mapping.debit] ?? "").trim();
        const credit = (row[mapping.credit] ?? "").trim();
        if (debit && credit) throw new Error("Both debit and credit contain values");
        if (!debit && !credit) throw new Error("Missing debit/credit amount");
        amountMinor = debit ? -Math.abs(parseStatementMoney(debit,options.numberFormat)) : Math.abs(parseStatementMoney(credit,options.numberFormat));
      }
      return { sourceRow: index + 2, postedDate, payee, amountMinor };
    } catch (reason) {
      return { sourceRow: index + 2, postedDate: "", payee: row[mapping.payee] ?? "", amountMinor: 0, error: reason instanceof Error ? reason.message : String(reason) };
    }
  });
  return classifyDuplicates(rows,existing);
}
