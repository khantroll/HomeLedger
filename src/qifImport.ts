import { normalizeDate, parseStatementMoney, transactionDuplicateKey, type PreviewRow } from "./csvImport";
import type { ImportTransactionRow, ImportTransactionSplit, Transaction } from "./domain";

export interface QifStatement {
  accountName?: string;
  accountType: "bank" | "cash" | "credit-card";
  rows: ImportTransactionRow[];
}

const SUPPORTED_TYPES = new Map([
  ["bank", "bank"],
  ["cash", "cash"],
  ["ccard", "credit-card"]
] as const);

export function parseQif(text: string): QifStatement {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!lines.some(line => /^!Type:/i.test(line.trim()))) throw new Error("This does not appear to be a QIF file");
  if (lines.some(line => /^!Type:Invst/i.test(line.trim()))) throw new Error("Investment-account QIF is not supported yet");

  let accountName: string | undefined;
  let readingAccount = false;
  let currentType: QifStatement["accountType"] | undefined;
  let statementType: QifStatement["accountType"] | undefined;
  let fields: string[] = [];
  const rows: ImportTransactionRow[] = [];

  const finishTransaction = () => {
    if (!fields.length || !currentType) { fields = []; return; }
    rows.push(parseTransaction(fields, rows.length + 1));
    statementType ??= currentType;
    if (statementType !== currentType) throw new Error("A QIF file containing multiple account types must be imported one account at a time");
    fields = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^!Account$/i.test(line.trim())) { finishTransaction(); readingAccount = true; currentType = undefined; continue; }
    const typeMatch = line.trim().match(/^!Type:(.+)$/i);
    if (typeMatch) {
      finishTransaction();
      readingAccount = false;
      const mapped = SUPPORTED_TYPES.get(typeMatch[1].trim().toLowerCase() as "bank" | "cash" | "ccard");
      if (mapped && rows.length) throw new Error("A QIF file containing multiple account sections must be imported one account at a time");
      currentType = mapped;
      continue;
    }
    if (line === "^") { if (readingAccount) readingAccount = false; else finishTransaction(); continue; }
    if (readingAccount) {
      if (line.startsWith("N") && line.slice(1).trim()) accountName = line.slice(1).trim();
      continue;
    }
    if (currentType && line && !line.startsWith("!")) fields.push(line);
  }
  finishTransaction();
  if (!statementType || !rows.length) throw new Error("No bank, cash, or credit-card transactions were found in this QIF file");
  return { accountName, accountType: statementType, rows };
}

export function buildQifPreview(statement: QifStatement, existing: Transaction[]): PreviewRow[] {
  const existingKeys = new Set(existing.map(item => transactionDuplicateKey(item.postedDate, item.payee, item.amountMinor)));
  const seen = new Set<string>();
  return statement.rows.map((row, index) => {
    const key = transactionDuplicateKey(row.postedDate, row.payee, row.amountMinor);
    const duplicate = existingKeys.has(key) || seen.has(key);
    seen.add(key);
    return { ...row, sourceRow: index + 1, duplicate };
  });
}

function parseTransaction(lines: string[], transactionNumber: number): ImportTransactionRow {
  let rawDate = "", rawAmount = "", payee = "", memo = "", reference = "", category: string | undefined;
  const splits: ImportTransactionSplit[] = [];
  let split: Partial<ImportTransactionSplit> | undefined;
  const finishSplit = () => {
    if (!split) return;
    if (!split.category) throw new Error(`Transaction ${transactionNumber} has a split without a category`);
    if (split.amountMinor === undefined) throw new Error(`Transaction ${transactionNumber} has a split without an amount`);
    splits.push(split as ImportTransactionSplit);
    split = undefined;
  };

  for (const line of lines) {
    const code = line[0], value = line.slice(1).trim();
    if (code === "D") rawDate = value;
    else if (code === "T") rawAmount = value;
    else if (code === "U" && !rawAmount) rawAmount = value;
    else if (code === "P") payee = value;
    else if (code === "M") memo = value;
    else if (code === "N") reference = value;
    else if (code === "L") category = normalizeCategory(value);
    else if (code === "S") { finishSplit(); split = { category: normalizeCategory(value) }; }
    else if (code === "E") { split ??= {}; split.memo = value || undefined; }
    else if (code === "$") { split ??= {}; split.amountMinor = parseStatementMoney(value); }
  }
  finishSplit();
  if (!rawDate) throw new Error(`Transaction ${transactionNumber} is missing a date`);
  if (!rawAmount) throw new Error(`Transaction ${transactionNumber} is missing an amount`);
  const amountMinor = parseStatementMoney(rawAmount);
  const combinedMemo = [memo, reference ? `Reference: ${reference}` : ""].filter(Boolean).join(" · ") || undefined;
  const description = payee || memo || (reference ? `Transaction ${reference}` : "QIF transaction");
  if (splits.length) {
    const splitTotal = splits.reduce((total, item) => {
      const next = total + item.amountMinor;
      if (!Number.isSafeInteger(next)) throw new Error(`Transaction ${transactionNumber} split total is too large`);
      return next;
    }, 0);
    if (splitTotal !== amountMinor) throw new Error(`Transaction ${transactionNumber} split total does not equal its amount`);
  }
  return {
    postedDate: normalizeDate(rawDate.replace("'", "/")),
    payee: description,
    amountMinor,
    memo: combinedMemo,
    category: splits.length ? "Split transaction" : category,
    splits: splits.length ? splits : undefined
  };
}

function normalizeCategory(value: string): string {
  const cleaned = value.trim();
  const transfer = cleaned.match(/^\[(.+)]$/);
  return transfer ? `Transfer: ${transfer[1].trim()}` : cleaned;
}
