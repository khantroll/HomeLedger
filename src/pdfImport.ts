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
export interface PdfExampleField { text:string; role:PdfFieldRole; }
export interface PdfCandidateLine { lineNumber:number; text:string; matched:boolean; teachable:boolean; }
export interface PdfParseResult {
  table:ParsedTable;
  extractedLineCount:number;
  candidateRowCount:number;
  matchedRowCount:number;
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
// Deliberately does not allow ordinary spaces inside the numeric body. That keeps
// adjacent statement columns such as "150.00- 15,929.95" as two independent tokens.
const MONEY_BODY=String.raw`(?:\d{1,3}(?:[,.'’]\d{3})+|\d+|)\.\d{2}`;
const MONEY_TOKEN=new RegExp(String.raw`(?:\(\s*[$€£]?\s*${MONEY_BODY}\s*\)|(?:[+−-]\s*[$€£]?\s*)?[$€£]?\s*${MONEY_BODY}\s*(?:[+−-]|CR|DR)?)`,"ig");
const EXPLICIT_SIGN=/(?:^\s*[+−-]|[+−-]\s*$|\b(?:CR|DR)\s*$|^\s*\()/i;
const NUMBER=String.raw`\d[\d,.'’]*[.,]\d{2}`;
const UNSIGNED_AMOUNT=String.raw`[$€£]?\s*${NUMBER}`;
const BALANCE_AMOUNT=String.raw`(?:\(?\s*[+−-]?\s*[$€£]?\s*${NUMBER}\s*[+−-]?\s*\)?)`;

interface TokenizedPdfLine { date:string; description:string; money:string[]; }
interface ParsedPdfLine extends TokenizedPdfLine {
  amount?:string;
  debit?:string;
  credit?:string;
  balance?:string;
}

function tokenizePdfLine(line:string):TokenizedPdfLine|null{
  const dateMatch=line.match(EXAMPLE_DATE);
  if(!dateMatch)return null;
  const date=dateMatch[1],rest=line.slice(dateMatch[0].length);
  const matches=[...rest.matchAll(MONEY_TOKEN)];
  if(!matches.length)return{date,description:rest.trim(),money:[]};
  const firstIndex=matches[0].index??0;
  return{
    date,
    description:rest.slice(0,firstIndex).replace(/\s+/g," ").trim(),
    money:matches.map(match=>match[0].replaceAll("−","-").replace(/\s+/g," ").trim())
  };
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
  const {money}=tokenized;
  const withBalance=layout.endsWith("before-balance");
  const expected=withBalance?2:1;
  if(money.length!==expected)return null;
  const transaction=money[0],balance=withBalance?money[1]:undefined;
  if(layout==="signed-last"&&!EXPLICIT_SIGN.test(transaction))return null;
  if(layout==="expenses-last"||layout==="expenses-before-balance")
    return{...tokenized,amount:`-${transaction}`,balance};
  return{...tokenized,amount:transaction,balance};
}

function cleanAmount(value:string|undefined):string{
  return (value??"").replaceAll("−","-").replace(/\s+/g," ").trim();
}

export function pdfTextToTable(text:string,layout:PdfLayout="signed-last"):PdfParseResult{
  const normalized=text.replaceAll("\u0000","").replaceAll("\r\n","\n").replaceAll("\r","\n");
  if(normalized.trim().length<20)throw new Error("This PDF has no searchable text. Scanned-statement OCR is not available yet.");
  const lines=normalized.split("\n"),rows:string[][]=[],sourceRows:number[]=[],unmatchedLineNumbers:number[]=[],candidateLines:PdfCandidateLine[]=[];
  const balanceMismatchLineNumbers:number[]=[];
  const debitCredit=layout.startsWith("debit-credit-");
  let previousMatched:{balanceMinor:number;candidateIndex:number}|null=null;

  lines.forEach((line,index)=>{
    if(!DATED_LINE.test(line))return;
    const lineNumber=index+1,parsed=parseLine(line,layout),teachable=pdfExampleFields(line,layout).length>=3;
    if(!parsed){
      unmatchedLineNumbers.push(lineNumber);
      candidateLines.push({lineNumber,text:line.trim(),matched:false,teachable});
      previousMatched=null;
      return;
    }
    if(debitCredit){
      rows.push([parsed.date,parsed.description,cleanAmount(parsed.debit),cleanAmount(parsed.credit)]);
    }else{
      rows.push([parsed.date,parsed.description,cleanAmount(parsed.amount)]);
    }
    sourceRows.push(lineNumber);
    const candidateIndex=candidateLines.length;
    candidateLines.push({lineNumber,text:line.trim(),matched:true,teachable});

    // Running-balance validation is deterministic only when two adjacent dated
    // candidates both parsed successfully. Any unmatched dated row breaks the chain.
    if(parsed.balance&&parsed.amount){
      try{
        const amountMinor=parseStatementMoney(parsed.amount);
        const balanceMinor=parseStatementMoney(parsed.balance);
        if(previousMatched&&previousMatched.candidateIndex===candidateIndex-1&&previousMatched.balanceMinor+amountMinor!==balanceMinor)
          balanceMismatchLineNumbers.push(lineNumber);
        previousMatched={balanceMinor,candidateIndex};
      }catch{previousMatched=null;}
    }else previousMatched=null;
  });
  return{
    table:{headers:debitCredit?["Date","Description","Debit","Credit"]:["Date","Description","Amount"],rows,delimiter:",",sourceRows},
    extractedLineCount:lines.length,
    candidateRowCount:candidateLines.length,
    matchedRowCount:rows.length,
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
  const rejected=result.candidateLines.filter(line=>!line.matched);
  const matched=result.candidateLines.filter(line=>line.matched);
  return [...rejected,...matched].slice(0,Math.max(0,limit));
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
  const tail=roles.slice(2),balanceIndex=tail.findIndex(role=>role==="balance");
  if(balanceIndex>=0&&balanceIndex!==tail.length-1)return null;
  const semantic=tail.filter(role=>role!=="ignore"&&role!=="balance");
  const hasBalance=balanceIndex===tail.length-1;
  if(semantic.length===1&&semantic[0]==="amount")return hasBalance?"signed-before-balance":"signed-last";
  if(semantic.length===2&&semantic[0]==="debit"&&semantic[1]==="credit")return hasBalance?"debit-credit-before-balance":"debit-credit-last";
  return null;
}
