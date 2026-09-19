import {describe,expect,it} from "vitest";
import {detectSubscriptions,normalizePayee} from "./subscriptionDetection";
import type {ScheduledTransaction,Transaction} from "./domain";

const transaction=(id:string,date:string,payee:string,amountMinor=-1599,category="Subscriptions"):Transaction=>({id,accountId:"checking",postedDate:date,payee,category,amountMinor,status:"cleared",source:"import"});

describe("detectSubscriptions",()=>{
  it("detects stable monthly expenses and explains the evidence",()=>{
    const result=detectSubscriptions([transaction("a","2026-05-15","STREAM CO 101"),transaction("b","2026-06-15","Stream Co 202"),transaction("c","2026-07-15","STREAM CO 303"),transaction("d","2026-08-15","Stream Co 404")],[],"2026-09-01");
    expect(result).toEqual([expect.objectContaining({payee:"Stream Co 404",amountMinor:-1599,frequency:"monthly",nextDueDate:"2026-09-15",occurrenceCount:4,medianIntervalDays:31,amountVariationMinor:0,confidence:"high"})]);
    expect(result[0].transactionIds).toEqual(["a","b","c","d"]);
  });
  it("supports weekly, biweekly, and annual cadence",()=>{
    const rows=[
      ...["2026-08-01","2026-08-08","2026-08-15"].map((date,index)=>transaction(`w${index}`,date,"Weekly Club",-500)),
      ...["2026-07-01","2026-07-15","2026-07-29"].map((date,index)=>transaction(`b${index}`,date,"Gym",-2500)),
      ...["2024-06-10","2025-06-10","2026-06-10"].map((date,index)=>transaction(`a${index}`,date,"Domain Host",-12000)),
    ];
    expect(detectSubscriptions(rows,[],"2026-08-20").map(item=>item.frequency).sort()).toEqual(["annual","biweekly","weekly"]);
  });
  it("rejects unstable amounts, irregular cadence, review rows, and stale series",()=>{
    const unstable=[transaction("a","2026-05-01","Variable",-1000),transaction("b","2026-06-01","Variable",-2000),transaction("c","2026-07-01","Variable",-1000)];
    const irregular=[transaction("d","2026-05-01","Random"),transaction("e","2026-05-04","Random"),transaction("f","2026-07-20","Random")];
    const review={...transaction("g","2026-08-01","Review"),status:"review" as const};
    expect(detectSubscriptions([...unstable,...irregular,review],[],"2026-09-01")).toEqual([]);
  });
  it("suppresses candidates already represented by a schedule",()=>{
    const rows=[transaction("a","2026-06-01","NETFLIX.COM 123"),transaction("b","2026-07-01","Netflix com 456"),transaction("c","2026-08-01","Netflix.com 789")];
    const template:ScheduledTransaction={id:"netflix",kind:"transaction",accountId:"checking",payee:"Netflix.com",category:"Subscriptions",amountMinor:-1599,status:"pending",frequency:"monthly",anchorDate:"2026-09-01",enabled:true};
    expect(detectSubscriptions(rows,[template],"2026-08-15")).toEqual([]);
    expect(normalizePayee(" NETFLIX.COM 123 ")).toBe("netflix com");
  });
});
