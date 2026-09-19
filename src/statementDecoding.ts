export type StatementEncoding="utf-8"|"utf-16le"|"utf-16be"|"windows-1252";

export interface DecodedStatement { text:string; encoding:StatementEncoding; }

export function decodeStatement(bytes:ArrayBuffer):DecodedStatement{
  const data=new Uint8Array(bytes);
  if(data.length>=2&&data[0]===0xff&&data[1]===0xfe)return{text:new TextDecoder("utf-16le").decode(data.subarray(2)),encoding:"utf-16le"};
  if(data.length>=2&&data[0]===0xfe&&data[1]===0xff)return{text:new TextDecoder("utf-16be").decode(data.subarray(2)),encoding:"utf-16be"};
  if(data.length>=3&&data[0]===0xef&&data[1]===0xbb&&data[2]===0xbf)return{text:new TextDecoder("utf-8",{fatal:true}).decode(data.subarray(3)),encoding:"utf-8"};
  const utf16=detectBomlessUtf16(data);
  if(utf16)return{text:new TextDecoder(utf16).decode(data),encoding:utf16};
  try{return{text:new TextDecoder("utf-8",{fatal:true}).decode(data),encoding:"utf-8"};}
  catch{return{text:new TextDecoder("windows-1252",{fatal:true}).decode(data),encoding:"windows-1252"};}
}

function detectBomlessUtf16(data:Uint8Array):"utf-16le"|"utf-16be"|undefined{
  const sample=Math.min(data.length,512);if(sample<8)return undefined;
  let evenNull=0,oddNull=0,pairs=0;
  for(let index=0;index+1<sample;index+=2){if(data[index]===0)evenNull++;if(data[index+1]===0)oddNull++;pairs++;}
  if(oddNull/pairs>.35&&evenNull/pairs<.1)return"utf-16le";
  if(evenNull/pairs>.35&&oddNull/pairs<.1)return"utf-16be";
  return undefined;
}

export function encodingLabel(value:StatementEncoding):string{return value==="windows-1252"?"Windows-1252":value==="utf-16le"?"UTF-16 LE":value==="utf-16be"?"UTF-16 BE":"UTF-8";}
