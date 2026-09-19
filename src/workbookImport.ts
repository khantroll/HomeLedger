import { suggestMapping, type ParsedTable } from "./csvImport";

export interface WorkbookSheet {
  name: string;
  firstRow: number;
  rows: string[][];
}

export interface ParsedWorkbook {
  sheets: WorkbookSheet[];
}

export interface WorkbookRepository {
  parseWorkbook(contentsBase64: string, fileName: string): Promise<ParsedWorkbook>;
}

export interface WorkbookSelection { sheetIndex:number; headerRow:number; }

const MAX_HEADER_CHOICES=50;

export function workbookHeaderChoices(sheet:WorkbookSheet):number[]{
  return sheet.rows.slice(0,MAX_HEADER_CHOICES).map((_,index)=>index).filter(index=>sheet.rows[index].some(value=>value.trim()));
}

export function suggestWorkbookHeaderRow(sheet:WorkbookSheet):number{
  const choices=workbookHeaderChoices(sheet);
  if(!choices.length)throw new Error(`Worksheet “${sheet.name}” is empty`);
  let best=choices[0],bestScore=-1;
  for(const index of choices){
    const mapping=suggestMapping(sheet.rows[index]);
    const amount=mapping.amount>=0||(mapping.debit>=0&&mapping.credit>=0);
    const score=(mapping.date>=0?4:0)+(mapping.payee>=0?4:0)+(amount?4:0)+sheet.rows[index].filter(value=>value.trim()).length/100;
    if(score>bestScore){best=index;bestScore=score;}
  }
  return best;
}

export function suggestWorkbookSelection(workbook:ParsedWorkbook):WorkbookSelection{
  let best:WorkbookSelection|null=null,bestScore=-1;
  workbook.sheets.forEach((sheet,sheetIndex)=>{
    try{
      const headerRow=suggestWorkbookHeaderRow(sheet),table=workbookSheetToTable(sheet,headerRow),mapping=suggestMapping(table.headers);
      const score=(mapping.date>=0?4:0)+(mapping.payee>=0?4:0)+(mapping.amount>=0||mapping.debit>=0&&mapping.credit>=0?4:0)+Math.min(table.rows.length,100)/100;
      if(score>bestScore){best={sheetIndex,headerRow};bestScore=score;}
    }catch{/* Ignore cover and empty sheets while finding the first usable table. */}
  });
  if(!best)throw new Error("The workbook does not contain a worksheet with a header and transaction rows");
  return best;
}

export function workbookSheetToTable(sheet:WorkbookSheet,headerRow:number):ParsedTable{
  const rawHeaders=sheet.rows[headerRow];
  if(!rawHeaders?.some(value=>value.trim()))throw new Error("Choose a non-empty header row");
  const width=Math.max(rawHeaders.length,...sheet.rows.slice(headerRow+1).map(row=>row.length));
  const headers=Array.from({length:width},(_,index)=>rawHeaders[index]?.trim()||`Column ${index+1}`);
  const rows=sheet.rows.slice(headerRow+1).map(row=>Array.from({length:width},(_,index)=>row[index]?.trim()??"")).filter(row=>row.some(value=>value));
  if(!rows.length)throw new Error(`Worksheet “${sheet.name}” needs at least one transaction row after the header`);
  return{headers,rows,delimiter:",",sourceRowOffset:sheet.firstRow+headerRow-1};
}

export function bytesToBase64(buffer:ArrayBuffer):string{
  const bytes=new Uint8Array(buffer);
  let result="";
  const chunkSize=0x8000;
  for(let index=0;index<bytes.length;index+=chunkSize)result+=String.fromCharCode(...bytes.subarray(index,index+chunkSize));
  return btoa(result);
}
