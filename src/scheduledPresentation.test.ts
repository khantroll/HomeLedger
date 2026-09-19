import { describe,expect,it } from "vitest";
import type { ScheduledOccurrence, ScheduledTransaction } from "./domain";
import { nextExpectedOccurrence, occurrenceDisplayState, occurrenceStateLabel, recurrenceDescription } from "./scheduledPresentation";

const template:ScheduledTransaction={id:"s",kind:"transaction",accountId:"a",payee:"Rent",category:"Housing",amountMinor:-100000,status:"pending",frequency:"monthly",anchorDate:"2026-01-31",enabled:true};
const occurrence=(patch:Partial<ScheduledOccurrence>):ScheduledOccurrence=>({id:"o",scheduledTransactionId:"s",dueDate:"2026-09-20",status:"expected",...patch});

describe("scheduled presentation",()=>{
  it("describes financial recurrence choices without exposing internals",()=>{
    expect(recurrenceDescription(template)).toBe("Monthly on the last day");
    expect(recurrenceDescription({...template,frequency:"biweekly"})).toBe("Every 2 weeks");
    expect(recurrenceDescription({...template,frequency:"semimonthly",anchorDate:"2026-01-15",secondMonthDay:31})).toBe("Twice monthly on the 15th and last day");
    expect(recurrenceDescription({...template,frequency:"custom",customIntervalCount:3,customIntervalUnit:"months"})).toBe("Every 3 months");
    expect(recurrenceDescription({...template,frequency:"annual",anchorDate:"2024-02-29"})).toBe("Annually on February 29");
  });

  it("distinguishes occurrence states with explicit labels",()=>{
    expect(occurrenceDisplayState(occurrence({dueDate:"2026-09-17"}),"2026-09-18")).toBe("overdue");
    expect(occurrenceStateLabel(occurrence({dueDate:"2026-09-18"}),"2026-09-18")).toBe("Due today");
    expect(occurrenceDisplayState(occurrence({dueDate:"2026-09-24"}),"2026-09-18")).toBe("due-soon");
    expect(occurrenceDisplayState(occurrence({dueDate:"2026-10-01"}),"2026-09-18")).toBe("upcoming");
    expect(occurrenceDisplayState(occurrence({status:"posted"}),"2026-09-18")).toBe("posted");
    expect(occurrenceDisplayState(occurrence({status:"skipped"}),"2026-09-18")).toBe("skipped");
    expect(occurrenceDisplayState(occurrence({status:"linked",transactionId:"t"}),"2026-09-18")).toBe("linked");
  });

  it("finds the next expected occurrence without hiding later schedule entries",()=>{
    const rows=[occurrence({id:"posted",dueDate:"2026-09-01",status:"posted",transactionId:"t"}),occurrence({id:"later",dueDate:"2026-10-31"}),occurrence({id:"next",dueDate:"2026-09-30"})];
    expect(nextExpectedOccurrence("s",rows)?.id).toBe("next");
  });
});
