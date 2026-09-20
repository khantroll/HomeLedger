import {describe,expect,it} from "vitest";
import type {ImportProfile} from "./domain";
import {matchingStatementTemplate,statementSourceSignature} from "./statementTemplates";

const profile:ImportProfile={id:"p",name:"River Credit Union",headerSignature:"date\u001fdescription\u001famount",sourceKind:"pdf",sourceSignature:"river credit union statement",pdfLayout:"expenses-last",dateColumn:0,payeeColumn:1,amountColumn:2,debitColumn:-1,creditColumn:-1,dateOrder:"mdy",numberFormat:"dot"};

describe("statement templates",()=>{
  it("makes dated statement filenames stable without retaining account numbers",()=>{
    const first=statementSourceSignature("River Credit Union Statement_7788_September-2026.pdf");
    expect(statementSourceSignature("River Credit Union Statement_9911_10-2026.pdf")).toBe(first);
    expect(first).toMatch(/^v1-[a-f0-9]{16}$/);
    expect(first).not.toContain("river");
  });

  it("matches both source kind and normalized signature",()=>{
    expect(matchingStatementTemplate([profile],"pdf","river credit union statement")?.id).toBe("p");
    expect(matchingStatementTemplate([profile],"ocr","river credit union statement")).toBeUndefined();
  });
});
