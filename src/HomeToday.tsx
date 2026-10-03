import {useEffect,useMemo,useState} from "react";
import {AlertTriangle,CalendarDays,CheckCircle2,Landmark,ReceiptText,Target,TrendingDown,WalletCards} from "lucide-react";
import {financeRepository as repository} from "./repository";
import {calculateCashFlowForecast} from "./forecastMath";
import {calculateSavingsGoal} from "./savingsGoalMath";
import {addDaysIso,formatDate,todayIso} from "./scheduledPresentation";
import {formatMoney,type Account,type BudgetMonth,type DebtPlan,type SavingsGoal,type ScheduledOccurrence,type ScheduledTransaction,type Transaction} from "./domain";
import type {NavigationIntent} from "./navigationIntent";
import "./homeToday.css";

type Attention={key:string;priority:number;tone:"negative"|"warning";title:string;detail:string;action:string;intent?:NavigationIntent;accountId?:string};
type Upcoming={occurrence:ScheduledOccurrence;template:ScheduledTransaction};

export function HomeToday({accounts,transactions,templates,occurrences,budgets,onNavigate,onOpenAccount,today=todayIso()}:{accounts:Account[];transactions:Transaction[];templates:ScheduledTransaction[];occurrences:ScheduledOccurrence[];budgets:BudgetMonth[];onNavigate:(intent:NavigationIntent)=>void;onOpenAccount:(accountId:string)=>void;today?:string}){
  const [goals,setGoals]=useState<SavingsGoal[]>([]),[debtPlan,setDebtPlan]=useState<DebtPlan>();
  const ordinary=useMemo(()=>accounts.filter(a=>a.type!=="investment"&&!a.archived),[accounts]);
  const cash=useMemo(()=>ordinary.filter(a=>["checking","savings","cash"].includes(a.type)),[ordinary]);
  const currency=cash[0]?.currency??ordinary[0]?.currency??"USD";
  useEffect(()=>{let live=true;void repository.listSavingsGoals().then(v=>{if(live)setGoals(v)}).catch(()=>{if(live)setGoals([])});void repository.getDebtPlan(currency).then(v=>{if(live)setDebtPlan(v)}).catch(()=>{if(live)setDebtPlan(undefined)});return()=>{live=false}},[currency]);

  const activeTemplates=useMemo(()=>new Map(templates.filter(t=>t.enabled&&!t.archived).map(t=>[t.id,t])),[templates]);
  const expected=useMemo(()=>occurrences.filter(o=>o.status==="expected"&&activeTemplates.has(o.scheduledTransactionId)),[occurrences,activeTemplates]);
  const forecast=useMemo(()=>calculateCashFlowForecast({today,horizonDays:30,currency,scenario:"expected",accounts:ordinary,templates,occurrences,budgets}),[today,currency,ordinary,templates,occurrences,budgets]);
  const currentBudget=budgets.find(b=>b.month===today.slice(0,7));
  const overdue=expected.filter(o=>o.dueDate<today).sort(byDate);
  const dueAuto=expected.filter(o=>o.dueDate<=today&&activeTemplates.get(o.scheduledTransactionId)?.autoPost).sort(byDate);
  const review=transactions.filter(t=>t.status==="review");
  const flagged=transactions.filter(t=>t.flagged);
  const accountReview=ordinary.filter(a=>a.needsReview).sort((a,b)=>a.name.localeCompare(b.name));
  const attention:Attention[]=[];
  if(overdue.length){const first=overdue[0],t=activeTemplates.get(first.scheduledTransactionId)!;attention.push({key:"overdue",priority:10,tone:"negative",title:`${t.payee} is overdue`,detail:overdue.length===1?`Due ${formatDate(first.dueDate)}.`:`${overdue.length} overdue items · oldest due ${formatDate(first.dueDate)}.`,action:"Review bills",intent:{page:"Bills",focus:{kind:"overdue",dueDate:first.dueDate}}})}
  if(dueAuto.length)attention.push({key:"autopost",priority:20,tone:"warning",title:`${dueAuto.length} automatic ${dueAuto.length===1?"posting is":"postings are"} due`,detail:"Ready for the reviewed auto-post queue.",action:"Review scheduled items",intent:{page:"Bills",focus:{kind:"autoPost"}}});
  if(review.length)attention.push({key:"review",priority:30,tone:"warning",title:`${review.length} ${review.length===1?"transaction needs":"transactions need"} review`,detail:"Confirm imported or uncategorized activity before treating the ledger as settled.",action:"Review transactions",intent:{page:"Transactions",status:"review"}});
  if(flagged.length)attention.push({key:"flagged",priority:35,tone:"warning",title:`${flagged.length} flagged ${flagged.length===1?"transaction":"transactions"} to revisit`,detail:"Follow-up flags stay visible here until you clear them.",action:"Open flagged transactions",intent:{page:"Transactions",status:"all",flaggedOnly:true}});
  if(accountReview.length)attention.push({key:"reconcile",priority:38,tone:"warning",title:`${accountReview[0].name} needs account review`,detail:accountReview.length===1?"Open the register to reconcile or review it.":`${accountReview.length} accounts are marked for review.`,action:"Open account",accountId:accountReview[0].id});
  if(forecast.lowestBalanceMinor<0)attention.push({key:"forecast",priority:40,tone:"negative",title:"Cash is projected to go negative",detail:`30-day low: ${formatMoney(forecast.lowestBalanceMinor,currency)} on ${formatDate(forecast.lowestBalanceDate)}.`,action:"Open forecast",intent:{page:"Forecast",focus:{horizonDays:30,highlightDate:forecast.lowestBalanceDate}}});
  const pressured=currentBudget?.lines.filter(l=>l.availableMinor<0).sort((a,b)=>a.availableMinor-b.availableMinor)??[];
  if(pressured.length){const line=pressured[0];attention.push({key:"budget",priority:50,tone:"negative",title:`${line.category} is over its monthly plan`,detail:`${formatMoney(Math.abs(line.availableMinor),currency)} over available · ${pressured.length} ${pressured.length===1?"category":"categories"} over plan.`,action:"Review budget",intent:{page:"Budget",focus:{month:today.slice(0,7)}}})}
  attention.sort((a,b)=>a.priority-b.priority||a.key.localeCompare(b.key));

  const upcoming:Upcoming[]=expected.filter(o=>o.dueDate>=today&&o.dueDate<=addDaysIso(today,14)&&!dueAuto.some(d=>d.id===o.id)).sort((a,b)=>byDate(a,b)||a.scheduledTransactionId.localeCompare(b.scheduledTransactionId)).slice(0,8).map(occurrence=>({occurrence,template:activeTemplates.get(occurrence.scheduledTransactionId)!}));
  const nextIncome=upcoming.find(x=>x.template.kind==="transaction"&&x.template.amountMinor>0);
  const nextMaterial=forecast.days.find(d=>d.date>today&&(d.inflowMinor>0||d.scheduledCount>0));
  const goalStates=goals.map(g=>({goal:g,account:ordinary.find(a=>a.id===g.accountId)})).filter(x=>x.account?.type==="savings").map(x=>({...x,projection:calculateSavingsGoal(x.goal,x.account!.balanceMinor,today)})).sort((a,b)=>statusRank(a.projection.status)-statusRank(b.projection.status)||a.goal.targetDate.localeCompare(b.goal.targetDate));
  const debtCount=debtPlan?.terms.filter(t=>t.enabled).length??0;
  const cashTotal=cash.filter(a=>a.currency===currency).reduce((n,a)=>n+a.balanceMinor,0);

  if(!ordinary.length)return <section className="panel home-setup"><Landmark size={28}/><div><h2>Build your Home page</h2><p>Add an ordinary household account and Home will organize what needs attention, what is coming up, and what happens next. Investment accounts stay separate from spendable cash.</p></div></section>;

  return <div className="home-today">
    <section className="panel home-attention"><div className="panel-heading"><div><h2>Needs attention</h2><p>{attention.length?`${attention.length} ${attention.length===1?"item needs":"items need"} a look.`:"Nothing needs your attention right now."}</p></div></div>
      {!attention.length?<div className="home-clear"><CheckCircle2 size={24}/><div><strong>You're caught up</strong><small>No overdue items, review or flagged transactions, account-review flags, negative 30-day cash forecast, or over-plan budget categories detected.</small></div></div>:<div className="home-action-list">{attention.map(item=><button key={item.key} className={`home-action ${item.tone}`} onClick={()=>item.intent?onNavigate(item.intent):item.accountId&&onOpenAccount(item.accountId)}><AlertTriangle size={17}/><span><strong>{item.title}</strong><small>{item.detail}</small></span><b>{item.action} →</b></button>)}</div>}
    </section>

    <div className="home-columns">
      <section className="panel home-coming"><div className="panel-heading"><div><h2>Coming up</h2><p>Expected bills, income, and meaningful transfers in the next 14 days.</p></div></div>{!upcoming.length?<div className="empty-state">No scheduled events in the next 14 days.</div>:<div className="home-upcoming">{upcoming.map(({occurrence,template})=><button key={occurrence.id} onClick={()=>onNavigate({page:"Bills",focus:{kind:"day",dueDate:occurrence.dueDate}})}><span>{formatDate(occurrence.dueDate)}</span><strong>{template.payee}</strong><small>{template.kind==="transfer"?"Scheduled transfer":template.amountMinor>0?"Expected income":template.category}</small><b className={template.amountMinor<0?"negative":""}>{formatMoney(template.amountMinor,currency)}</b></button>)}</div>}</section>
      <section className="panel home-now"><div className="panel-heading"><div><h2>Money right now</h2><p>Ordinary household money; investment value is not treated as spendable cash.</p></div></div><div className="home-cash-total"><WalletCards size={20}/><span><small>Checking, savings & cash</small><strong>{formatMoney(cashTotal,currency)}</strong></span></div><div className="home-account-list">{ordinary.filter(a=>a.currency===currency).slice(0,6).map(a=><button key={a.id} onClick={()=>onOpenAccount(a.id)}><span>{a.name}<small>{a.type==="credit"||a.type==="loan"?"Amount owed / liability":"Current ledger balance"}</small></span><strong className={a.balanceMinor<0?"negative":""}>{formatMoney(a.balanceMinor,a.currency)}</strong></button>)}</div>{accounts.some(a=>a.type==="investment"&&!a.archived)&&<p className="home-boundary">Investment accounts are available in Portfolio and are intentionally excluded from cash available here.</p>}</section>
    </div>

    <div className="home-columns">
      <section className="panel home-plan"><div className="panel-heading"><div><h2>Plan status</h2><p>Pressure and progress from plans you already maintain.</p></div></div>{!currentBudget?.lines.length&&!goalStates.length&&!debtCount?<div className="home-plan-empty"><strong>No active household plans yet</strong><small>Budget, savings goals, and debt payoff plans are optional. Home stays useful without them.</small><button onClick={()=>onNavigate({page:"Budget",focus:{month:today.slice(0,7)}})}>Set up a budget →</button></div>:<div className="home-plan-list">{currentBudget?.lines.length?<button onClick={()=>onNavigate({page:"Budget",focus:{month:today.slice(0,7)}})}><Target size={16}/><span><strong>{pressured.length?`${pressured.length} budget ${pressured.length===1?"category is":"categories are"} under pressure`:"Monthly budget is within plan"}</strong><small>{formatMoney(currentBudget.spentMinor,currency)} spent · {formatMoney(currentBudget.availableMinor,currency)} available</small></span></button>:null}{goalStates[0]&&<button onClick={()=>onNavigate({page:"Budget",focus:{month:today.slice(0,7)}})}><Target size={16}/><span><strong>{goalStates[0].goal.name}: {goalLabel(goalStates[0].projection.status)}</strong><small>{goalStates[0].projection.progressPercent}% funded · {formatMoney(goalStates[0].projection.remainingMinor,currency)} remaining</small></span></button>}{debtCount>0&&<button onClick={()=>onNavigate({page:"Debt"})}><TrendingDown size={16}/><span><strong>Debt payoff plan active</strong><small>{debtCount} {debtCount===1?"account":"accounts"} included · open the plan for deterministic payoff projections</small></span></button>}</div>}</section>
      <section className="panel home-next"><div className="panel-heading"><div><h2>What happens next</h2><p>The 30-day expected forecast translated into the next useful checkpoint.</p></div></div>{forecast.lowestBalanceMinor<0?<button className="home-next-callout danger" onClick={()=>onNavigate({page:"Forecast",focus:{horizonDays:30,highlightDate:forecast.lowestBalanceDate}})}><AlertTriangle size={22}/><span><strong>Cash falls below zero on the current plan</strong><small>Projected low {formatMoney(forecast.lowestBalanceMinor,currency)} on {formatDate(forecast.lowestBalanceDate)}. Open the forecast to see the sequence.</small></span></button>:<button className="home-next-callout" onClick={()=>onNavigate({page:"Forecast",focus:{horizonDays:30,highlightDate:nextMaterial?.date??forecast.lowestBalanceDate}})}><CheckCircle2 size={22}/><span><strong>Cash stays above zero for the next 30 days</strong><small>Lowest projected cash is {formatMoney(forecast.lowestBalanceMinor,currency)} on {formatDate(forecast.lowestBalanceDate)}.{nextIncome?` Next expected income: ${nextIncome.template.payee} on ${formatDate(nextIncome.occurrence.dueDate)}.`:nextMaterial?` Next scheduled cash-flow point: ${formatDate(nextMaterial.date)}.`:" No scheduled cash-flow event changes the picture."}</small></span></button>}</section>
    </div>
  </div>;
}
function byDate(a:ScheduledOccurrence,b:ScheduledOccurrence){return a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id)}
function statusRank(s:string){return s==="overdue"?0:s==="at-risk"?1:s==="on-track"?2:3}
function goalLabel(s:string){return s==="at-risk"?"at risk":s==="on-track"?"on track":s==="overdue"?"target date passed":"complete"}
