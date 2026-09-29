import type { ParsedTable } from "./csvImport";

export interface PdfExtraction { text:string; }
export interface PdfRepository { extractText(contentsBase64:string,fileName:string):Promise<PdfExtraction>; }
export type PdfLayout=
  |"signed-last"
  |"signed-before-balance"
  |"debit-credit-last"
  |"debit-credit-before-balance"
  |"expenses-last"
  |"expenses-before-balance";
export interface PdfCandidateLine { lineNumber:number; text:string; matched:boolean; }
export interface PdfParseResult {
  table:ParsedTable;
  extractedLineCount:number;
  candidateRowCount:number;
  matchedRowCount:number;
  unmatchedLineNumbers:number[];
  candidateLines:PdfCandidateLine[];
  layout:PdfLayout;
}

export const PDF_LAYOUT_OPTIONS:{value:PdfLayout;label:string;description:string}[]=[
  {value:"signed-last",label:"Signed amount at end",description:"Date · description · signed amount"},
  {value:"signed-before-balance",label:"Signed amount + balance",description:"Date · description · signed amount · running balance"},
  {value:"debit-credit-last",label:"Separate debit / credit",description:"Date · description · debit · credit"},
  {value:"debit-credit-before-balance",label:"Debit / credit + balance",description:"Date · description · debit · credit · running balance"},
  {value:"expenses-last",label:"Credit-card charges",description:"Date · description · unsigned charge (import as expense)"},
  {value:"expenses-before-balance",label:"Charges + balance",description:"Date · description · unsigned charge · running balance"}
];

const DATE=String.raw`\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/](?:\d{2}|\d{4})`;
const NUMBER=String.raw`\d[\d\s,.'’]*[.,]\d{2}`;
const UNSIGNED_AMOUNT=String.raw`[$€£]?\s*${NUMBER}`;
const SIGNED_AMOUNT=String.raw`(?:\(\s*[$€£]?\s*${NUMBER}\s*\)|(?:[+−-]\s*[$€£]?|[$€£]\s*[+−-])\s*${NUMBER}|[$€£]?\s*${NUMBER}\s*(?:CR|DR))`;
const BALANCE_AMOUNT=String.raw`(?:\(?\s*[+−-]?\s*[$€£]?\s*${NUMBER}\s*\)?)`;
const DATED_LINE=new RegExp(String.raw`^\s*(?:${DATE})(?:\s|$)`,"i");

function debitCreditPattern(withBalance:boolean):RegExp{
  // Separate debit/credit layouts rely on visible column spacing from PDF/OCR text.
  // Blank debit or credit cells are allowed only when the column gap remains visible.
  const tail=withBalance?String.raw`\s{2,}(${BALANCE_AMOUNT})`:"";
  return new RegExp(String.raw`^\s*(${DATE})\s+(.+?)\s{2,}(${UNSIGNED_AMOUNT})?\s{2,}(${UNSIGNED_AMOUNT})?${tail}\s*$`,"i");
}

function layoutPattern(layout:PdfLayout):RegExp{
  if(layout==="signed-before-balance")return new RegExp(String.raw`^\s*(${DATE})\s+(.+?)\s+(${SIGNED_AMOUNT})\s+${BALANCE_AMOUNT}\s*$`,"i");
  if(layout==="expenses-last")return new RegExp(String.raw`^\s*(${DATE})\s+(.+?)\s+(${UNSIGNED_AMOUNT})\s*$`,"i");
  if(layout==="expenses-before-balance")return new RegExp(String.raw`^\s*(${DATE})\s+(.+?)\s+(${UNSIGNED_AMOUNT})\s+${BALANCE_AMOUNT}\s*$`,"i");
  if(layout==="debit-credit-last")return debitCreditPattern(false);
  if(layout==="debit-credit-before-balance")return debitCreditPattern(true);
  return new RegExp(String.raw`^\s*(${DATE})\s+(.+?)\s+(${SIGNED_AMOUNT})\s*$`,"i");
}

function cleanAmount(value:string|undefined):string{
  return (value??"").replaceAll("−","-").replace(/\s+/g," ").trim();
}

export function pdfTextToTable(text:string,layout:PdfLayout="signed-last"):PdfParseResult{
  const normalized=text.replaceAll("\u0000","").replaceAll("\r\n","\n").replaceAll("\r","\n");
  if(normalized.trim().length<20)throw new Error("This PDF has no searchable text. Scanned-statement OCR is not available yet.");
  const lines=normalized.split("\n"),rows:string[][]=[],sourceRows:number[]=[],unmatchedLineNumbers:number[]=[],candidateLines:PdfCandidateLine[]=[],pattern=layoutPattern(layout);
  const debitCredit=layout.startsWith("debit-credit-");
  lines.forEach((line,index)=>{
    if(!DATED_LINE.test(line))return;
    const lineNumber=index+1,match=line.match(pattern);
    if(!match){unmatchedLineNumbers.push(lineNumber);candidateLines.push({lineNumber,text:line.trim(),matched:false});return;}
    const [,date,payee]=match;
    if(!payee.trim()){unmatchedLineNumbers.push(lineNumber);candidateLines.push({lineNumber,text:line.trim(),matched:false});return;}
    if(debitCredit){
      const debit=cleanAmount(match[3]),credit=cleanAmount(match[4]);
      // A row must identify exactly one side. Ambiguous or empty rows stay rejected.
      if((debit&&credit)||(!debit&&!credit)){
        unmatchedLineNumbers.push(lineNumber);candidateLines.push({lineNumber,text:line.trim(),matched:false});return;
      }
      rows.push([date.trim(),payee.replace(/\s+/g," ").trim(),debit,credit]);
    }else{
      const rawAmount=cleanAmount(match[3]);
      if(!rawAmount){unmatchedLineNumbers.push(lineNumber);candidateLines.push({lineNumber,text:line.trim(),matched:false});return;}
      const amount=layout.startsWith("expenses-")?`-${rawAmount}`:rawAmount;
      rows.push([date.trim(),payee.replace(/\s+/g," ").trim(),amount]);
    }
    sourceRows.push(lineNumber);
    candidateLines.push({lineNumber,text:line.trim(),matched:true});
  });
  return{
    table:{headers:debitCredit?["Date","Description","Debit","Credit"]:["Date","Description","Amount"],rows,delimiter:",",sourceRows},
    extractedLineCount:lines.length,
    candidateRowCount:candidateLines.length,
    matchedRowCount:rows.length,
    unmatchedLineNumbers,
    candidateLines,
    layout
  };
}

export function suggestPdfLayout(text:string):PdfLayout{
  for(const layout of ["signed-last","signed-before-balance","debit-credit-last","debit-credit-before-balance"] as const){
    const parsed=pdfTextToTable(text,layout);
    if(parsed.matchedRowCount>0&&!parsed.unmatchedLineNumbers.length)return layout;
  }
  return"signed-last";
}

export function isPdfComplete(result:PdfParseResult):boolean{return result.matchedRowCount>0&&result.unmatchedLineNumbers.length===0;}

export function representativePdfLines(result:PdfParseResult,limit=6):PdfCandidateLine[]{
  const rejected=result.candidateLines.filter(line=>!line.matched);
  const matched=result.candidateLines.filter(line=>line.matched);
  return [...rejected,...matched].slice(0,Math.max(0,limit));
}
