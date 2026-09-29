import {parseStatementMoney,type ParsedTable} from "./csvImport";

export interface PdfExtraction { text:string; }
export interface PdfRepository { extractText(contentsBase64:string,fileName:string):Promise<PdfExtraction>; }
export type PdfLayout=
  |"signed-last"
  |"signed-before-balance"
  |"debit-credit-last"
  |"debit-credit-before-balance"
  |"expenses-last"
  |"expenses-before-balance";
export type PdfFieldRole="date"|"payee"|"amount"|"debit"|"credit"|"balance"|"ignore";
export type PdfLineClassification="transaction"|"continuation"|"unresolved";
export interface PdfExampleField { text:string; role:PdfFieldRole; }
export interface PdfCandidateLine {
  lineNumber:number;
  text:string;
  matched:boolean;
  teachable:boolean;
  classification:PdfLineClassification;
}
export interface PdfParseResult {
  table:ParsedTable;
  extractedLineCount:number;
  irrelevantLineCount:number;
  candidateRowCount:number;
  matchedRowCount:number;
  continuationLineNumbers:number[];
  unmatchedLineNumbers:number[];
  balanceMismatchLineNumbers:number[];
  candidateLines:PdfCandidateLine[];
  layout:PdfLayout;
}

export const PDF_LAYOUT_OPTIONS:{value:PdfLayout;label:string;description:string}[]=[
  {value:"signed-last",label:"Signed amount at end",description:"Date · description · explicitly signed amount"},
  {value:"signed-before-balance",label:"Signed amount + balance",description:"Date · description · signed amount · running balance"},
  {value:"debit-credit-last",label:"Separate debit / credit",description:"Date · description · debit · credit"},
  {value:"debit-credit-before-balance",label:"Debit / credit + balance",description:"Date · description · debit · credit · running balance"},
  {value:"expenses-last",label:"Credit-card charges",description:"Date · description · unsigned charge (import as expense)"},
  {value:"expenses-before-balance",label:"Charges + balance",description:"Date · description · unsigned charge · running balance"}
];

const DATE=String.raw`\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/](?:\d{2}|\d{4})`;
const DATED_LINE=new RegExp(String.raw`^\s*(?:${DATE})(?:\s|$)`,"i");
const EXAMPLE_DATE=new RegExp(String.raw`^\s*(${DATE})(?:\s+|$)`,"i");
const RAW_MONEY_NUMBER=/(?:\d{1,3}(?:[,.'’]\d{3})+|\d+)[.,]\d{2}/g;
const EXPLICIT_SIGN=/(?:^\s*[+−-]|[+−-]\s*$|(?:CR|DR)\s*$|^\s*\()/i;
const NUMBER=String.raw`\d[\d,.'’]*[.,]\d{2}`;
const UNSIGNED_AMOUNT=String.raw`[$€£]?\s*${NUMBER}`;
const BALANCE_AMOUNT=String.raw`(?:\(?\s*[+−-]?\s*[$€£]?\s*${NUMBER}\s*[+−-]?\s*\)?)`;

interface MoneyToken { text:string; start:number; end:number; }
interface TokenizedPdfLine { date:string; description:string; money:string[]; }
interface ParsedPdfLine extends TokenizedPdfLine {
  amount?:string;
  debit?:string;
  credit?:string;
  balance?:string;
}
interface CandidateWork {
  lineNumber:number;
  text:string;
  parsed:ParsedPdfLine|null;
  tokenized:TokenizedPdfLine|null;
  teachable:boolean;
  classification:PdfLineClassification;
}

function amountTokens(rest:string):MoneyToken[]{
  const matches=[...rest.matchAll(RAW_MONEY_NUMBER)];
  return matches.map((match,index)=>{
    const start=match.index??0,end=start+match[0].length;
    const previousEnd=index===0?0:(matches[index-1].index??0)+matches[index-1][0].length;
    const nextStart=index+1<matches.length?(matches[index+1].index??rest.length):rest.length;
    const before=rest.slice(previousEnd,start);
    const after=rest.slice(end,nextStart);
    let text=match[0];

    // OCR commonly separates a printed trailing minus from the amount:
    // "150.00 - 15,929.95". The sign belongs to the first number, not the balance.
    const trailing=after.match(/^\s*([+−-]|CR|DR)\s*$/i);
    if(trailing)text+=trailing[1];

    if(index===0&&!trailing){
      const prefix=before.match(/([+−-])\s*[$€£]?\s*$/);
      if(prefix)text=prefix[1]+text;
      const openParen=/\(\s*$/.test(before),closeParen=/^\s*\)/.test(after);
      if(openParen&&closeParen)text=`(${text})`;
    }
    return{text:text.replaceAll("−","-"),start,end};
  });
}

function tokenizePdfLine(line:string):TokenizedPdfLine|null{
  const dateMatch=line.match(EXAMPLE_DATE);
  if(!dateMatch)return null;
  const date=dateMatch[1],rest=line.slice(dateMatch[0].length),tokens=amountTokens(rest);
  if(!tokens.length)return{date,description:rest.trim(),money:[]};
  let description=rest.slice(0,tokens[0].start).replace(/[+−-]\s*[$€£]?\s*$/,"").replace(/[($€£]\s*$/,"").replace(/\s+/g," ").trim();
  return{date,description,money:tokens.map(token=>token.text)};
}

function debitCreditPattern(withBalance:boolean):RegExp{
  const tail=withBalance?String.raw`\s{2,}(${BALANCE_AMOUNT})`:"";
  return new RegExp(String.raw`^\s*(${DATE})\s+(.+?)\s{2,}(${UNSIGNED_AMOUNT})?\s{2,}(${UNSIGNED_AMOUNT})?${tail}\s*$`,"i");
}

function parseLine(line:string,layout:PdfLayout):ParsedPdfLine|null{
  if(layout.startsWith("debit-credit-")){
    const match=line.match(debitCreditPattern(layout.endsWith("before-balance")));
    if(!match)return null;
    const [,date,description,debitRaw,creditRaw,balanceRaw]=match;
    const debit=(debitRaw??"").trim(),credit=(creditRaw??"").trim();
    if(!description.trim()||(debit&&credit)||(!debit&&!credit))return null;
    return{date:date.trim(),description:description.replace(/\s+/g," ").trim(),money:[],debit,credit,balance:balanceRaw?.trim()};
  }

  const tokenized=tokenizePdfLine(line);
  if(!tokenized||!tokenized.description)return null;
  const withBalance=layout.endsWith("before-balance"),expected=withBalance?2:1;
  if(tokenized.money.length!==expected)return null;
  const transaction=tokenized.money[0],balance=withBalance?tokenized.money[1]:undefined;
  if(layout==="signed-last"&&!EXPLICIT_SIGN.test(transaction))return null;
  if(layout==="expenses-last"||layout==="expenses-before-balance")return{...tokenized,amount:`-${transaction}`,balance};
  return{...tokenized,amount:transaction,balance};
}

function cleanAmount(value:string|undefined):string{
  return (value??"").replaceAll("−","-").replace(/\s+/g," ").trim();
}

function continuity(previous:ParsedPdfLine,next:ParsedPdfLine):boolean|null{
  if(!previous.balance||!next.balance||!next.amount)return null;
  try{
    return parseStatementMoney(previous.balance)+parseStatementMoney(next.amount)===parseStatementMoney(next.balance);
  }catch{return null;}
}

export function pdfTextToTable(text:string,layout:PdfLayout="signed-last"):PdfParseResult{
  const normalized=text.replaceAll("\u0000","").replaceAll("\r\n","\n").replaceAll("\r","\n");
  if(normalized.trim().length<20)throw new Error("This PDF has no searchable text. Scanned-statement OCR is not available yet.");
  const lines=normalized.split("\n"),work:CandidateWork[]=[];
  let irrelevantLineCount=0;

  lines.forEach((line,index)=>{
    if(!line.trim())return;
    if(!DATED_LINE.test(line)){irrelevantLineCount++;return;}
    const parsed=parseLine(line,layout),tokenized=tokenizePdfLine(line);
    work.push({
      lineNumber:index+1,
      text:line.trim(),
      parsed,
      tokenized,
      teachable:Boolean(tokenized&&tokenized.money.length>0),
      classification:parsed?"transaction":"unresolved"
    });
  });

  const transactionIndexes=work.map((item,index)=>item.parsed?index:-1).filter(index=>index>=0);
  const balanceMismatchLineNumbers:number[]=[];
  for(let i=1;i<transactionIndexes.length;i++){
    const previousIndex=transactionIndexes[i-1],nextIndex=transactionIndexes[i];
    const previous=work[previousIndex].parsed!,next=work[nextIndex].parsed!;
    const check=continuity(previous,next);
    const between=work.slice(previousIndex+1,nextIndex);
    const unresolvedWithMoney=between.some(item=>item.classification==="unresolved"&&(item.tokenized?.money.length??0)>0);
    if(check===true&&!unresolvedWithMoney){
      for(let index=previousIndex+1;index<nextIndex;index++){
        if(work[index].classification==="unresolved"&&(work[index].tokenized?.money.length??0)===0)
          work[index].classification="continuation";
      }
    }else if(check===false&&between.length===0){
      balanceMismatchLineNumbers.push(work[nextIndex].lineNumber);
    }
  }

  const rows:string[][]=[],sourceRows:number[]=[];
  for(const item of work){
    if(!item.parsed)continue;
    const parsed=item.parsed;
    if(layout.startsWith("debit-credit-"))rows.push([parsed.date,parsed.description,cleanAmount(parsed.debit),cleanAmount(parsed.credit)]);
    else rows.push([parsed.date,parsed.description,cleanAmount(parsed.amount)]);
    sourceRows.push(item.lineNumber);
  }

  const candidateLines:PdfCandidateLine[]=work.map(item=>({
    lineNumber:item.lineNumber,
    text:item.text,
    matched:item.classification==="transaction",
    teachable:item.teachable,
    classification:item.classification
  }));
  const unmatchedLineNumbers=work.filter(item=>item.classification==="unresolved").map(item=>item.lineNumber);
  const continuationLineNumbers=work.filter(item=>item.classification==="continuation").map(item=>item.lineNumber);

  return{
    table:{headers:layout.startsWith("debit-credit-")?["Date","Description","Debit","Credit"]:["Date","Description","Amount"],rows,delimiter:",",sourceRows},
    extractedLineCount:lines.length,
    irrelevantLineCount,
    candidateRowCount:work.length,
    matchedRowCount:rows.length,
    continuationLineNumbers,
    unmatchedLineNumbers,
    balanceMismatchLineNumbers,
    candidateLines,
    layout
  };
}

export function suggestPdfLayout(text:string):PdfLayout{
  for(const layout of ["signed-before-balance","debit-credit-before-balance","signed-last","debit-credit-last"] as const){
    const parsed=pdfTextToTable(text,layout);
    if(parsed.matchedRowCount>0&&!parsed.unmatchedLineNumbers.length&&!parsed.balanceMismatchLineNumbers.length)return layout;
  }
  return"signed-last";
}

export function isPdfComplete(result:PdfParseResult):boolean{
  return result.matchedRowCount>0&&result.unmatchedLineNumbers.length===0&&result.balanceMismatchLineNumbers.length===0;
}

export function representativePdfLines(result:PdfParseResult,limit=6):PdfCandidateLine[]{
  const unresolved=result.candidateLines.filter(line=>line.classification==="unresolved");
  const transactions=result.candidateLines.filter(line=>line.classification==="transaction");
  const continuations=result.candidateLines.filter(line=>line.classification==="continuation");
  return [...unresolved,...transactions,...continuations].slice(0,Math.max(0,limit));
}

export function pdfExampleFields(line:string,layout:PdfLayout):PdfExampleField[]{
  const tokenized=tokenizePdfLine(line);
  if(!tokenized)return[];
  const roles:PdfFieldRole[]=layout.startsWith("debit-credit-")
    ?["debit","credit",...(layout.endsWith("before-balance")?["balance" as const]:[])]
    :["amount",...(layout.endsWith("before-balance")?["balance" as const]:[])];
  return[
    {text:tokenized.date,role:"date"},
    {text:tokenized.description,role:"payee"},
    ...tokenized.money.map((text,index)=>({text,role:roles[index]??"ignore"}))
  ];
}

export function pdfLayoutFromFieldRoles(roles:PdfFieldRole[]):PdfLayout|null{
  if(roles[0]!=="date"||roles[1]!=="payee")return null;
  const tail=roles.slice(2),balanceIndexes=tail.map((role,index)=>role==="balance"?index:-1).filter(index=>index>=0);
  if(balanceIndexes.length>1)return null;
  const hasBalance=balanceIndexes.length===1;
  if(hasBalance&&tail.slice(balanceIndexes[0]+1).some(role=>role!=="ignore"))return null;
  const semantic=tail.filter(role=>role!=="ignore"&&role!=="balance");
  if(semantic.length===1&&semantic[0]==="amount")return hasBalance?"signed-before-balance":"signed-last";
  if(semantic.length===2&&semantic[0]==="debit"&&semantic[1]==="credit")return hasBalance?"debit-credit-before-balance":"debit-credit-last";
  return null;
}
