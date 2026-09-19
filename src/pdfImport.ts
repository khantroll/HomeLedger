import type { ParsedTable } from "./csvImport";

export interface PdfExtraction { text:string; }
export interface PdfRepository { extractText(contentsBase64:string,fileName:string):Promise<PdfExtraction>; }
export type PdfLayout="signed-last"|"signed-before-balance"|"expenses-last"|"expenses-before-balance";
export interface PdfParseResult { table:ParsedTable; extractedLineCount:number; candidateRowCount:number; matchedRowCount:number; unmatchedLineNumbers:number[]; layout:PdfLayout; }

export const PDF_LAYOUT_OPTIONS:{value:PdfLayout;label:string;description:string}[]=[
  {value:"signed-last",label:"Signed amount at end",description:"Date · description · signed amount"},
  {value:"signed-before-balance",label:"Signed amount + balance",description:"Date · description · signed amount · running balance"},
  {value:"expenses-last",label:"Credit-card charges",description:"Date · description · unsigned charge (import as expense)"},
  {value:"expenses-before-balance",label:"Charges + balance",description:"Date · description · unsigned charge · running balance"}
];

const DATE=String.raw`\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/](?:\d{2}|\d{4})`;
const NUMBER=String.raw`\d[\d\s,.'’]*[.,]\d{2}`;
const UNSIGNED_AMOUNT=String.raw`[$€£]?\s*${NUMBER}`;
const SIGNED_AMOUNT=String.raw`(?:\(\s*[$€£]?\s*${NUMBER}\s*\)|(?:[+−-]\s*[$€£]?|[$€£]\s*[+−-])\s*${NUMBER}|[$€£]?\s*${NUMBER}\s*(?:CR|DR))`;
const BALANCE_AMOUNT=String.raw`(?:\(?\s*[+−-]?\s*[$€£]?\s*${NUMBER}\s*\)?)`;
const DATED_LINE=new RegExp(String.raw`^\s*(?:${DATE})(?:\s|$)`,"i");

function layoutPattern(layout:PdfLayout):RegExp{
  if(layout==="signed-before-balance")return new RegExp(String.raw`^\s*(${DATE})\s+(.+?)\s+(${SIGNED_AMOUNT})\s+${BALANCE_AMOUNT}\s*$`,"i");
  if(layout==="expenses-last")return new RegExp(String.raw`^\s*(${DATE})\s+(.+?)\s+(${UNSIGNED_AMOUNT})\s*$`,"i");
  if(layout==="expenses-before-balance")return new RegExp(String.raw`^\s*(${DATE})\s+(.+?)\s+(${UNSIGNED_AMOUNT})\s+${BALANCE_AMOUNT}\s*$`,"i");
  return new RegExp(String.raw`^\s*(${DATE})\s+(.+?)\s+(${SIGNED_AMOUNT})\s*$`,"i");
}

export function pdfTextToTable(text:string,layout:PdfLayout="signed-last"):PdfParseResult{
  const normalized=text.replaceAll("\u0000","").replaceAll("\r\n","\n").replaceAll("\r","\n");
  if(normalized.trim().length<20)throw new Error("This PDF has no searchable text. Scanned-statement OCR is not available yet.");
  const lines=normalized.split("\n"),rows:string[][]=[],sourceRows:number[]=[],unmatchedLineNumbers:number[]=[],pattern=layoutPattern(layout);
  lines.forEach((line,index)=>{
    if(!DATED_LINE.test(line))return;
    const match=line.match(pattern);
    if(!match){unmatchedLineNumbers.push(index+1);return;}
    const [,date,payee,rawAmount]=match;
    if(!payee.trim()){unmatchedLineNumbers.push(index+1);return;}
    const normalizedAmount=rawAmount.replaceAll("−","-").replace(/\s+/g," ").trim();
    const amount=layout.startsWith("expenses-")?`-${normalizedAmount}`:normalizedAmount;
    rows.push([date.trim(),payee.replace(/\s+/g," ").trim(),amount]);
    sourceRows.push(index+1);
  });
  return{table:{headers:["Date","Description","Amount"],rows,delimiter:",",sourceRows},extractedLineCount:lines.length,candidateRowCount:rows.length+unmatchedLineNumbers.length,matchedRowCount:rows.length,unmatchedLineNumbers,layout};
}

export function suggestPdfLayout(text:string):PdfLayout{
  for(const layout of ["signed-last","signed-before-balance"] as const){const parsed=pdfTextToTable(text,layout);if(parsed.matchedRowCount>0&&!parsed.unmatchedLineNumbers.length)return layout;}
  return"signed-last";
}

export function isPdfComplete(result:PdfParseResult):boolean{return result.matchedRowCount>0&&result.unmatchedLineNumbers.length===0;}
