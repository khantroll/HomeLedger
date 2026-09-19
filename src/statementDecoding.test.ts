import { describe,expect,it } from "vitest";
import { decodeStatement } from "./statementDecoding";

describe("local statement decoding",()=>{
  it("detects UTF-8 and BOM-marked UTF-16",()=>{
    expect(decodeStatement(new TextEncoder().encode("Date,Payee\n2026-01-01,Café").buffer)).toMatchObject({encoding:"utf-8"});
    const utf16=new Uint8Array([0xff,0xfe,..."A,B\n1,2".split("").flatMap(character=>[character.charCodeAt(0),0])]);
    expect(decodeStatement(utf16.buffer)).toEqual({encoding:"utf-16le",text:"A,B\n1,2"});
  });

  it("falls back to Windows-1252 when UTF-8 validation fails",()=>{
    const decoded=decodeStatement(new Uint8Array([0x50,0x61,0x79,0xe9,0x65]).buffer);
    expect(decoded).toEqual({encoding:"windows-1252",text:"Payée"});
  });
});
