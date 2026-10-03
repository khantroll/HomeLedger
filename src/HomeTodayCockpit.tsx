import {AlertTriangle,ArrowLeftRight,CalendarDays,CircleDollarSign,Flag,Landmark,PiggyBank,ReceiptText,Tags,TrendingDown,WalletCards} from "lucide-react";
import type {Account,BudgetMonth,DebtPlan,SavingsGoal,ScheduledOccurrence,ScheduledTransaction,Transaction} from "./domain";
import {formatMoney} from "./domain";
import type {HouseholdCurrencyValuation} from "./householdValuation";
import type {NavigationIntent} from "./navigationIntent";
import {buildHomeTodayModel,type HomeAttentionItem,type HomeTodayModel} from "./homeToday";
import {formatDate,occurrenceDisplayState,occurrenceStateLabel,todayIso} from "./scheduledPresentation";
import "./overviewCommand.css";

export function HomeTodayCockpit({
  accounts,transactions,templates,occurrences,budgets,goals,debtPlans,household,onNavigate,onOpenAccount,today=todayIso(),
}:{
  accounts:Account[];
  transactions:Transaction[];
  templates:ScheduledTransaction[];
  occurrences:ScheduledOccurrence[];
  budgets:BudgetMonth[];
  goals:SavingsGoal[];
  debtPlans:DebtPlan[];
  household:HouseholdCurrencyValuation;
  onNavigate:(intent:NavigationIntent)=>void;
  onOpenAccount:(accountId:string)=>void;
  today?:string;
}){
  const model=buildHomeTodayModel({today,currency:household.currency,accounts,transactions,templates,occurrences,budgets,goals,debtPlans});
  return <div className="home-cockpit">
    <NeedsAttention model={model} onNavigate={onNavigate}/>
    <ComingUp model={model} accounts={accounts} onNavigate={onNavigate}/>
    <div className="home-cockpit-grid">
      <MoneyRightNow household={household} accounts={accounts} onOpenAccount={onOpenAccount}/>
      <PlanStatus model={model} onNavigate={onNavigate}/>
    </div>
    <WhatHappensNext model={model} onNavigate={onNavigate}/>
  </div>;
}

function NeedsAttention({model,onNavigate}:{model:HomeTodayModel;onNavigate:(intent:NavigationIntent)=>void}){
  return <section className="panel command-center" aria-labelledby="home-attention-title">
    <div className="panel-heading"><div><h2 id="home-attention-title">Needs attention</h2><p>{model.attention.length?\`\${model.attention.length} \${model.attention.length===1?"item needs":"items need"} a look.\`:"Nothing urgent needs your attention."}</p></div></div>
    {model.attention.length===0?<div className="attention-clear"><span className="command-icon positive">✓</span><span><strong>You’re caught up</strong><small>No overdue scheduled items, review or flagged transactions, negative 30-day cash forecast, budget overage, or at-risk savings goal detected.</small></span></div>:
      <div className="attention-list">{model.attention.map(item=><AttentionRow key={item.key} item={item} currency={model.currency} model={model} onNavigate={onNavigate}/>)}</div>}
  </section>;
}

function AttentionRow({item,currency,model,onNavigate}:{item:HomeAttentionItem;currency:string;model:HomeTodayModel;onNavigate:(intent:NavigationIntent)=>void}){
  const icon=item.key==="overdue"?<AlertTriangle size={16}/>:item.key==="autopost"?<CalendarDays size={16}/>:item.key==="review"?<ReceiptText size={16}/>:item.key==="flagged"?<Flag size={16}/>:item.key==="forecast"?<TrendingDown size={16}/>:item.key==="budget"?<Tags size={16}/>:<PiggyBank size={16}/>;
  let detail=item.detail;
  if(item.key==="forecast")detail=\`30-day low: \${formatMoney(model.forecast.lowestBalanceMinor,currency)} on \${formatDate(model.forecast.lowestBalanceDate)}.\`;
  if(item.key==="budget"&&model.currentBudget)detail=\`\${formatMoney(Math.abs(model.currentBudget.availableMinor),currency)} over the available plan; \${formatMoney(model.currentBudget.spentMinor,currency)} spent.\`;
  const goalId=item.key.startsWith("goal-")?item.key.slice(5):undefined;
  const goal=goalId?model.goals.find(value=>value.goal.id===goalId):undefined;
  if(goal)detail=\`\${goal.projection.progressPercent}% funded · \${formatMoney(goal.projection.remainingMinor,goal.account?.currency??currency)} remaining.\`;
  return <button type="button" className={\`attention-item \${item.tone}\`} onClick={()=>onNavigate(item.intent)}>
    <span className={\`command-icon \${item.tone}\`}>{icon}</span>
    <span className="attention-copy"><strong>{item.title}</strong><small>{detail}</small></span>
    <span className="attention-action">{item.action} →</span>
  </button>;
}

function ComingUp({model,accounts,onNavigate}:{model:HomeTodayModel;accounts:Account[];onNavigate:(intent:NavigationIntent)=>void}){
  const rows=model.upcoming.slice(0,8);
  return <section className="panel upcoming-widget" aria-labelledby="home-coming-up-title">
    <div className="panel-heading"><div><h2 id="home-coming-up-title">Coming up</h2><p>Bills, expected income, and meaningful transfers in the next 30 days.</p></div>{rows[0]&&<button type="button" onClick={()=>onNavigate(rows[0].intent)}><CalendarDays size={14}/> Open Bills</button>}</div>
    {!rows.length?<div className="empty-state">No scheduled financial events in the next 30 days.</div>:<div className="upcoming-list">{rows.map(row=>{
      const account=accounts.find(item=>item.id===row.accountId),destination=accounts.find(item=>item.id===row.transferAccountId);
      return <button type="button" className="upcoming-row upcoming-row-button" key={row.occurrenceId} onClick={()=>onNavigate(row.intent)} aria-label={\`Open \${row.payee} on \${formatDate(row.dueDate)} on the bills calendar\`}>
        <span>{formatDate(row.dueDate)}</span>
        <div><strong>{row.payee}</strong><small>{row.kind==="transfer"?<><ArrowLeftRight size={10}/> {account?.name} → {destination?.name}</>:row.kind==="income"?\`Expected income · \${account?.name??"Account"}\`:\`Bill · \${account?.name??"Account"}\`}</small></div>
        <span className={row.kind==="transfer"?"amount":row.amountMinor<0?"amount negative":"amount positive"}>{formatMoney(row.amountMinor,account?.currency??model.currency)}</span>
        <span className={\`home-event-kind \${row.kind}\`}>{row.kind==="bill"?"Bill":row.kind==="income"?"Income":"Transfer"}</span>
      </button>;
    })}</div>}
    {model.upcoming.length>rows.length&&<div className="home-more"><button type="button" onClick={()=>onNavigate(model.upcoming[rows.length].intent)}>See later scheduled items →</button></div>}
  </section>;
}

function MoneyRightNow({household,accounts,onOpenAccount}:{household:HouseholdCurrencyValuation;accounts:Account[];onOpenAccount:(accountId:string)=>void}){
  const ordinary=accounts.filter(account=>!account.archived&&account.type!=="investment"&&account.currency===household.currency);
  const cash=ordinary.filter(account=>["checking","savings","cash"].includes(account.type)).sort((a,b)=>Math.abs(b.balanceMinor)-Math.abs(a.balanceMinor)||a.name.localeCompare(b.name)).slice(0,3);
  return <section className="panel home-money" aria-labelledby="home-money-title">
    <div className="panel-heading"><div><h2 id="home-money-title">Money right now</h2><p>Spendable cash stays separate from investment value.</p></div></div>
    <div className="home-money-summary">
      <div><span>Available cash</span><strong>{formatMoney(household.availableCashMinor,household.currency)}</strong><small>Positive checking, savings, and cash balances</small></div>
      <div><span>Liabilities</span><strong className={household.liabilitiesMinor<0?"negative":""}>{formatMoney(Math.abs(household.liabilitiesMinor),household.currency)}</strong><small>Credit and loan balances</small></div>
      <div><span>Net worth</span><strong>{formatMoney(household.netWorthKnownMinor,household.currency)}</strong><small>{household.incompleteInvestment?"Known subtotal; some investments are unvalued":"Ordinary + investment value"}</small></div>
    </div>
    {cash.length>0&&<div className="home-account-shortlist">{cash.map(account=><button type="button" key={account.id} onClick={()=>onOpenAccount(account.id)}><span><WalletCards size={14}/><strong>{account.name}</strong></span><span className={account.balanceMinor<0?"negative":""}>{formatMoney(account.balanceMinor,account.currency)}</span></button>)}</div>}
  </section>;
}

function PlanStatus({model,onNavigate}:{model:HomeTodayModel;onNavigate:(intent:NavigationIntent)=>void}){
  const budget=model.currentBudget;
  const visibleGoals=model.goals.slice(0,2);
  const debt=model.debts[0];
  const hasPlan=Boolean(budget?.lines.length||visibleGoals.length||debt);
  return <section className="panel home-plan" aria-labelledby="home-plan-title">
    <div className="panel-heading"><div><h2 id="home-plan-title">Plan status</h2><p>Budget, savings, and debt plans that can change what you do next.</p></div></div>
    {!hasPlan?<div className="attention-clear"><span className="command-icon quiet"><PiggyBank size={16}/></span><span><strong>No planning setup yet</strong><small>Budgets, savings goals, and debt plans are optional. Set them up when they help.</small></span></div>:<div className="home-plan-list">
      {budget?.lines.length?<button type="button" onClick={()=>onNavigate({page:"Budget",focus:{month:budget.month}})}><Tags size={15}/><span><strong>Monthly budget</strong><small>{formatMoney(budget.availableMinor,model.currency)} available · {formatMoney(budget.spentMinor,model.currency)} spent</small></span><b>{budget.availableMinor<0?"Over plan":"On plan"}</b></button>:null}
      {visibleGoals.map(({goal,account,projection})=><button type="button" key={goal.id} onClick={()=>onNavigate({page:"Budget",focus:{month:model.forecast.days[0]?.date.slice(0,7)??goal.targetDate.slice(0,7)}})}><PiggyBank size={15}/><span><strong>{goal.name}</strong><small>{projection.progressPercent}% funded · {formatMoney(projection.remainingMinor,account?.currency??model.currency)} remaining</small></span><b>{projection.status==="at-risk"?"At risk":projection.status==="overdue"?"Overdue":projection.status==="complete"?"Complete":"On track"}</b></button>)}
      {debt?<button type="button" onClick={()=>onNavigate({page:"Debt"})}><CircleDollarSign size={15}/><span><strong>{debt.plan.strategy[0].toUpperCase()+debt.plan.strategy.slice(1)} debt plan</strong><small>{formatMoney(debt.projection.startingBalanceMinor,debt.plan.currency)} starting balance · {formatMoney(debt.projection.monthlyPaymentMinor,debt.plan.currency)} planned monthly</small></span><b>{debt.projection.complete&&debt.projection.debtFreeMonth?\`Debt-free \${monthLabel(debt.projection.debtFreeMonth)}\`:"Review plan"}</b></button>:null}
    </div>}
  </section>;
}

function WhatHappensNext({model,onNavigate}:{model:HomeTodayModel;onNavigate:(intent:NavigationIntent)=>void}){
  const next=model.nextCashFlow;
  return <section className="panel home-next" aria-labelledby="home-next-title">
    <div className="panel-heading"><div><h2 id="home-next-title">What happens next</h2><p>A plain-language read of the existing 30-day deterministic cash forecast.</p></div><button type="button" onClick={()=>onNavigate({page:"Forecast",focus:{horizonDays:30,highlightDate:next?.date??model.forecast.lowestBalanceDate}})}>Open forecast</button></div>
    {next?<div className={\`home-next-callout \${next.safeThrough?"safe":"warning"}\`}><Landmark size={20}/><div><strong>{next.safeThrough?"Cash stays non-negative through the next scheduled cash-flow point.":"Cash falls below zero before or at the next scheduled cash-flow point."}</strong><p><button type="button" onClick={()=>onNavigate(next.intent)}>{next.title} · {formatDate(next.date)}</button> changes projected cash by {formatMoney(next.amountMinor,model.currency)}; expected cash after that day is {formatMoney(next.balanceAfterMinor,model.currency)}.</p><small>30-day projected low: {formatMoney(model.forecast.lowestBalanceMinor,model.currency)} on {formatDate(model.forecast.lowestBalanceDate)}.</small></div></div>:
      <div className="home-next-callout safe"><Landmark size={20}/><div><strong>No scheduled cash-flow event is coming in the next 30 days.</strong><p>The existing forecast still projects a low of {formatMoney(model.forecast.lowestBalanceMinor,model.currency)} on {formatDate(model.forecast.lowestBalanceDate)}.</p></div></div>}
  </section>;
}

/** Compatibility surface for existing tests and callers; Home now uses HomeTodayCockpit. */
export function OverviewCommandCenter({accounts,transactions,templates,occurrences,budgets,onNavigate,today=todayIso()}:{accounts:Account[];transactions:Transaction[];templates:ScheduledTransaction[];occurrences:ScheduledOccurrence[];budgets:BudgetMonth[];onNavigate:(intent:NavigationIntent)=>void;today?:string}){
  const currency=accounts.find(item=>["checking","savings","cash"].includes(item.type))?.currency??accounts[0]?.currency??"USD";
  const model=buildHomeTodayModel({today,currency,accounts,transactions,templates,occurrences,budgets,goals:[],debtPlans:[]});
  return <NeedsAttention model={model} onNavigate={onNavigate}/>;
}

/** Compatibility surface retained for the Bills-calendar launch behavior covered before #66. */
export function UpcomingScheduled({accounts,templates,occurrences,onNavigate}:{accounts:Account[];templates:ScheduledTransaction[];occurrences:ScheduledOccurrence[];onNavigate?:(intent:NavigationIntent)=>void;}){
  const today=todayIso();
  const rows=occurrences.filter(item=>item.status==="expected"&&templates.some(template=>template.id===item.scheduledTransactionId&&template.enabled&&!template.archived)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const openDay=(dueDate:string)=>onNavigate?.({page:"Bills",focus:{kind:"day",dueDate}});
  const openCalendar=()=>openDay(rows[0]?.dueDate??today);
  return <section className="panel upcoming-widget"><div className="panel-heading"><div><h2>Coming up</h2><p>Expected bills, deposits, and transfers — open any row to see it on the Bills calendar</p></div>{onNavigate?<button type="button" onClick={openCalendar}><CalendarDays size={14}/> Open calendar</button>:<CalendarDays size={18}/>}</div>
    {rows.length===0?<div className="empty-state">No scheduled events in the next 90 days.</div>:<div className="upcoming-list">{rows.map(occurrence=>{const template=templates.find(item=>item.id===occurrence.scheduledTransactionId)!,account=accounts.find(item=>item.id===template.accountId),destination=accounts.find(item=>item.id===template.transferAccountId),state=occurrenceDisplayState(occurrence,today);const body=<><span>{formatDate(occurrence.dueDate)}</span><div><strong>{template.payee}</strong><small>{template.kind==="transfer"?<><ArrowLeftRight size={10}/> {account?.name} → {destination?.name}</>:<>{account?.name} · {template.category}</>}</small></div><span className={template.kind==="transfer"?"amount":template.amountMinor<0?"amount negative":"amount positive"}>{formatMoney(template.amountMinor,account?.currency)}</span><span className={\`occurrence-state \${state}\`}>{occurrenceStateLabel(occurrence,today)}</span></>;return onNavigate?<button type="button" className="upcoming-row upcoming-row-button" key={occurrence.id} onClick={()=>openDay(occurrence.dueDate)} aria-label={\`Open \${template.payee} on \${formatDate(occurrence.dueDate)} on the bills calendar\`}>{body}</button>:<div className="upcoming-row" key={occurrence.id}>{body}</div>;})}</div>}
  </section>;
}

function monthLabel(value:string){return new Intl.DateTimeFormat("en-US",{month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(\`\${value}-01T00:00:00Z\`));}
