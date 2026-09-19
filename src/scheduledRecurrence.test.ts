import { describe,expect,it } from "vitest";
import type { ScheduledTransaction } from "./domain";
import { generateRecurrenceDates } from "./scheduledRecurrence";

function schedule(patch:Partial<ScheduledTransaction>):ScheduledTransaction{
  return{id:"s",kind:"transaction",accountId:"a",payee:"Bill",category:"Bills",amountMinor:-100,status:"pending",frequency:"monthly",anchorDate:"2026-01-01",enabled:true,...patch};
}

describe("scheduled recurrence generation",()=>{
  it("generates weekly and distinct biweekly dates",()=>{
    expect(generateRecurrenceDates(schedule({frequency:"weekly",anchorDate:"2026-12-20"}),"2026-12-20","2027-01-10")).toEqual(["2026-12-20","2026-12-27","2027-01-03","2027-01-10"]);
    expect(generateRecurrenceDates(schedule({frequency:"biweekly",anchorDate:"2026-12-20"}),"2026-12-20","2027-01-31")).toEqual(["2026-12-20","2027-01-03","2027-01-17","2027-01-31"]);
  });

  it("preserves intended Jan 29, 30, and 31 month days after February",()=>{
    expect(generateRecurrenceDates(schedule({anchorDate:"2023-01-29"}),"2023-01-01","2023-04-30")).toEqual(["2023-01-29","2023-02-28","2023-03-29","2023-04-29"]);
    expect(generateRecurrenceDates(schedule({anchorDate:"2023-01-30"}),"2023-01-01","2023-04-30")).toEqual(["2023-01-30","2023-02-28","2023-03-30","2023-04-30"]);
    expect(generateRecurrenceDates(schedule({anchorDate:"2023-01-31"}),"2023-01-01","2023-04-30")).toEqual(["2023-01-31","2023-02-28","2023-03-31","2023-04-30"]);
  });

  it("handles leap years and restores February 29 for annual schedules",()=>{
    expect(generateRecurrenceDates(schedule({anchorDate:"2024-01-31"}),"2024-01-01","2024-03-31")).toEqual(["2024-01-31","2024-02-29","2024-03-31"]);
    expect(generateRecurrenceDates(schedule({frequency:"annual",anchorDate:"2024-02-29"}),"2024-01-01","2028-12-31")).toEqual(["2024-02-29","2025-02-28","2026-02-28","2027-02-28","2028-02-29"]);
  });

  it("clamps February anchors and crosses year boundaries without drift",()=>{
    expect(generateRecurrenceDates(schedule({anchorDate:"2026-02-28"}),"2026-02-01","2026-05-31")).toEqual(["2026-02-28","2026-03-28","2026-04-28","2026-05-28"]);
    expect(generateRecurrenceDates(schedule({anchorDate:"2026-11-30"}),"2026-11-01","2027-02-28")).toEqual(["2026-11-30","2026-12-30","2027-01-30","2027-02-28"]);
  });

  it("generates two semimonthly dates and deduplicates clamped month-end collisions",()=>{
    expect(generateRecurrenceDates(schedule({frequency:"semimonthly",anchorDate:"2026-01-15",secondMonthDay:31}),"2026-01-01","2026-03-31")).toEqual(["2026-01-15","2026-01-31","2026-02-15","2026-02-28","2026-03-15","2026-03-31"]);
    expect(generateRecurrenceDates(schedule({frequency:"semimonthly",anchorDate:"2026-01-30",secondMonthDay:31}),"2026-02-01","2026-02-28")).toEqual(["2026-02-28"]);
  });

  it("supports custom day, week, month, and year intervals",()=>{
    expect(generateRecurrenceDates(schedule({frequency:"custom",anchorDate:"2026-01-01",customIntervalCount:10,customIntervalUnit:"days"}),"2026-01-01","2026-02-01")).toEqual(["2026-01-01","2026-01-11","2026-01-21","2026-01-31"]);
    expect(generateRecurrenceDates(schedule({frequency:"custom",anchorDate:"2026-01-01",customIntervalCount:3,customIntervalUnit:"weeks"}),"2026-01-01","2026-02-28")).toEqual(["2026-01-01","2026-01-22","2026-02-12"]);
    expect(generateRecurrenceDates(schedule({frequency:"custom",anchorDate:"2026-01-31",customIntervalCount:2,customIntervalUnit:"months"}),"2026-01-01","2026-07-31")).toEqual(["2026-01-31","2026-03-31","2026-05-31","2026-07-31"]);
    expect(generateRecurrenceDates(schedule({frequency:"custom",anchorDate:"2024-02-29",customIntervalCount:2,customIntervalUnit:"years"}),"2024-01-01","2030-12-31")).toEqual(["2024-02-29","2026-02-28","2028-02-29","2030-02-28"]);
  });

  it("honors inclusive windows and the configured end date",()=>{
    const recurrence=schedule({frequency:"weekly",anchorDate:"2026-01-01",endDate:"2026-01-20"});
    expect(generateRecurrenceDates(recurrence,"2026-01-08","2026-02-01")).toEqual(["2026-01-08","2026-01-15"]);
  });
});
