import { parseStatementMoney, transactionDuplicateKey, type PreviewRow } from "./csvImport";
import type { ImportTransactionRow, Transaction } from "./domain";

export interface OfxStatement {
  accountIdMasked: string;
  accountType: "bank" | "credit-card";
  currency: string;
  dateStart?: string;
  dateEnd?: string;
  ledgerBalanceMinor?: number;
  rows: ImportTransactionRow[];
}

export function parseOfx(text: string): OfxStatement {
  const content = text.replace(/^\uFEFF/, "");
  if (!/<OFX[>\s]/i.test(content)) throw new Error("This does not appear to be an OFX/QFX file");
  if (/<INVSTMTRS>|<INVTRANLIST>/i.test(content)) throw new Error("Investment-account OFX requires the later investment-import module");
  const accountType = /<CCSTMTRS>/i.test(content) ? "credit-card" : "bank";
  const accountId = field(content, "ACCTID") || "";
  const currency = (field(content, "CURDEF") || "USD").toUpperCase();
  const blocks = [...content.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi)].map(match => match[1]);
  if (!blocks.length) throw new Error("No bank or credit-card transactions were found in this OFX/QFX file");
  const rows = blocks.map((block, index) => {
    const rawDate = field(block, "DTPOSTED");
    const rawAmount = field(block, "TRNAMT");
    if (!rawDate) throw new Error(`Transaction ${index + 1} is missing DTPOSTED`);
    if (!rawAmount) throw new Error(`Transaction ${index + 1} is missing TRNAMT`);
    const type = field(block, "TRNTYPE") || "Transaction";
    const name = decodeEntities(field(block, "NAME") || "").trim();
    const memo = decodeEntities(field(block, "MEMO") || "").trim();
    const payee = name || memo || `${type} transaction`;
    return {
      postedDate: normalizeOfxDate(rawDate),
      payee,
      amountMinor: parseStatementMoney(rawAmount),
      memo: name && memo && name !== memo ? memo : undefined,
      externalId: cleanExternalId(field(block, "FITID"))
    };
  });
  const ledger = field(content.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|(?=<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>))/i)?.[1] || "", "BALAMT");
  return {
    accountIdMasked: accountId ? `••••${accountId.slice(-4)}` : "Not supplied",
    accountType,
    currency,
    dateStart: optionalOfxDate(field(content, "DTSTART")),
    dateEnd: optionalOfxDate(field(content, "DTEND")),
    ledgerBalanceMinor: ledger ? parseStatementMoney(ledger) : undefined,
    rows
  };
}

export function buildOfxPreview(statement: OfxStatement, existing: Transaction[]): PreviewRow[] {
  const existingIds = new Set(existing.map(item => item.externalId).filter(Boolean));
  const existingKeys = new Set(existing.map(item => transactionDuplicateKey(item.postedDate, item.payee, item.amountMinor)));
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  return statement.rows.map((row, index) => {
    const key = transactionDuplicateKey(row.postedDate, row.payee, row.amountMinor);
    const idDuplicate = Boolean(row.externalId && (existingIds.has(row.externalId) || seenIds.has(row.externalId)));
    const fallbackDuplicate = existingKeys.has(key) || seenKeys.has(key);
    if (row.externalId) seenIds.add(row.externalId);
    seenKeys.add(key);
    return { ...row, sourceRow: index + 1, duplicate: idDuplicate || fallbackDuplicate };
  });
}

function field(content: string, tag: string): string | undefined {
  const match = content.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, "i"));
  return match?.[1]?.trim() || undefined;
}

function normalizeOfxDate(value: string): string {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) throw new Error(`Unsupported OFX date: ${value}`);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) throw new Error(`Invalid OFX date: ${value}`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function optionalOfxDate(value?: string): string | undefined { return value ? normalizeOfxDate(value) : undefined; }
function cleanExternalId(value?: string): string | undefined { const cleaned = value?.trim(); return cleaned ? cleaned.slice(0, 255) : undefined; }
function decodeEntities(value: string): string { return value.replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'"); }
