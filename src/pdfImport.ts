import type { ParsedTable } from "./csvImport";

export interface PdfExtraction { text:string; }
export interface PdfRepository { extractText(contentsBase64:string,fileName:string):Promise<PdfExtraction>; }
export interface PdfParseResult { table:ParsedTable; extractedLineCount:number; matchedRowCount:number; }

const DATE=String.raw`(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/](?:\d{2}|\d{4}))`;
const NUMBER=String.raw`\d[\d\s,.'’]*[.,]\d{2}`;
const SIGNED_AMOUNT=String.raw`(\(\s*[$€£]?\s*${NUMBER}\s*\)|(?:[+−-]\s*[$€£]?|[$€£]\s*[+−-])\s*${NUMBER}|[$€£]?\s*${NUMBER}\s*(?:CR|DR))`;
const TRANSACTION_LINE=new RegExp(String.raw`^\s*${DATE}\s+(.+?)\s+${SIGNED_AMOUNT}\s*$`,"i");

export function pdfTextToTable(text:string):PdfParseResult{
  const normalized=text.replaceAll("\u0000","").replaceAll("\r\n","\n").replaceAll("\r","\n");
  if(normalized.trim().length<20)throw new Error("This PDF has no searchable text. Scanned-statement OCR is not available yet.");
  const lines=normalized.split("\n"),rows:string[][]=[],sourceRows:number[]=[];
  lines.forEach((line,index)=>{
    const match=line.match(TRANSACTION_LINE);
    if(!match)return;
    const [,date,payee,amount]=match;
    if(!payee.trim())return;
    rows.push([date.trim(),payee.replace(/\s+/g," ").trim(),amount.replaceAll("−","-").replace(/\s+/g," ").trim()]);
    sourceRows.push(index+1);
  });
  if(!rows.length)throw new Error("Searchable text was found, but no supported transaction rows were recognized. This first PDF importer requires a full date, description, and explicitly signed amount on one line.");
  return{table:{headers:["Date","Description","Amount"],rows,delimiter:",",sourceRows},extractedLineCount:lines.length,matchedRowCount:rows.length};
}
