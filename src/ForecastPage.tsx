import {useEffect,useMemo,useState} from "react";
import {CalendarRange,ShieldCheck,TrendingDown,TrendingUp} from "lucide-react";
import {formatMoney,type Account,type BudgetMonth,type ScheduledOccurrence,type ScheduledTransaction} from "./domain";
import {financeRepository as repository} from "./repository";
import {addDaysIso,formatDate,todayIso} from "./scheduledPresentation";
import {calculateCashFlowForecast,forecastMonths,type CashFlowForecast,type ForecastScenario} from "./forecastMath";
import "./forecast.css";

const horizons=[30,60,90,180,365] as const;
const scenarioCopy:Record<ForecastScenario,{label:string;detail:string}>={
  expected:{label:"Expected",detail:"Scheduled amounts and remaining monthly plans as entered."},
  conservative:{label:"Conservative",detail:"10% less income and 10% more scheduled and planned spending."},
  optimistic:{label:"Optimistic",detail:"5% more income, 5% less scheduled spending, and 10% less planned spending."},
};

export function ForecastPage({accounts,templates,today=todayIso()}:{accounts:Account[];templates:ScheduledTransaction[];today?:string}){
  const currencies=useMemo(()=>[...new Set(accounts.filter(item=>["checking","savings","cash"].includes(item.type)).map(item=>item.currency))].sort(),[accounts]);
  const [horizon,setHorizon]=useState<(typeof horizons)[number]>(90),[scenario,setScenario]=useState<ForecastScenario>("expected"),[currency,setCurrency]=useState(currencies[0]??"USD");
  const [scope,setScope]=useState("all");
  const [occurrences,setOccurrences]=useState<ScheduledOccurrence[]>([]),[budgets,setBudgets]=useState<BudgetMonth[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const availableCashAccounts=useMemo(()=>accounts.filter(item=>["checking","savings","cash"].includes(item.type)&&item.currency===currency),[accounts,currency]);
  useEffect(()=>{if(currencies.length&&!currencies.includes(currency))setCurrency(currencies[0]);},[currencies,currency]);
  useEffect(()=>{if(scope!=="all"&&!availableCashAccounts.some(item=>item.id===scope))setScope("all");},[availableCashAccounts,scope]);
  useEffect(()=>{let current=true;setLoading(true);setError("");const toDate=addDaysIso(today,horizon-1);void repository.generateScheduledOccurrences({fromDate:today,toDate}).then(()=>Promise.all([repository.listScheduledOccurrences({fromDate:today,toDate}),Promise.all(forecastMonths(today,horizon).map(month=>repository.getBudgetMonth(month)))])).then(([nextOccurrences,nextBudgets])=>{if(current){setOccurrences(nextOccurrences);setBudgets(nextBudgets);setLoading(false);}}).catch(reason=>{if(current){setError(reason instanceof Error?reason.message:String(reason));setLoading(false);}});return()=>{current=false;};},[horizon,today]);
  const selectedAccounts=scope==="all"?accounts:accounts.filter(item=>item.id===scope);
  const forecasts=useMemo(()=>Object.fromEntries((["expected","conservative","optimistic"] as const).map(name=>[name,calculateCashFlowForecast({today,horizonDays:horizon,currency,scenario:name,accounts:selectedAccounts,templates,occurrences,budgets:scope==="all"?budgets:[]})])) as Record<ForecastScenario,CashFlowForecast>,[budgets,currency,horizon,occurrences,scope,selectedAccounts,templates,today]);
  const forecast=forecasts[scenario],cashAccounts=scope==="all"?availableCashAccounts:availableCashAccounts.filter(item=>item.id===scope);
  return <div className="forecast-page">
    <section className="panel forecast-header"><div><h2>Cash-flow forecast</h2><p>See how scheduled bills, deposits, and remaining budget plans could change available cash.</p></div><div className="forecast-controls"><label>Currency<select value={currency} onChange={event=>setCurrency(event.target.value)}>{currencies.length?currencies.map(item=><option key={item}>{item}</option>):<option>USD</option>}</select></label><label>Accounts<select value={scope} onChange={event=>setScope(event.target.value)}><option value="all">Household cash</option>{availableCashAccounts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="horizon-buttons" aria-label="Forecast horizon">{horizons.map(value=><button className={horizon===value?"active":""} key={value} onClick={()=>setHorizon(value)}>{value}d</button>)}</div></div></section>
    {error&&<div className="error-banner" role="alert">{error}</div>}
    {!cashAccounts.length?<section className="panel empty-state">Add a checking, savings, or cash account to create a forecast.</section>:<>
      <div className="scenario-picker">{(["expected","conservative","optimistic"] as const).map(name=><button className={scenario===name?"active":""} key={name} onClick={()=>setScenario(name)}><span>{scenarioCopy[name].label}</span><strong>{formatMoney(forecasts[name].endingBalanceMinor,currency)}</strong><small>projected ending cash</small></button>)}</div>
      <div className="summary-grid forecast-summary"><Summary label="Starting cash" value={formatMoney(forecast.startBalanceMinor,currency)} detail={`${cashAccounts.length} liquid account${cashAccounts.length===1?"":"s"}`}/><Summary label="Projected ending" value={formatMoney(forecast.endingBalanceMinor,currency)} detail={`${horizon}-day ${scenarioCopy[scenario].label.toLowerCase()} view`} tone={forecast.endingBalanceMinor<0?"negative":"positive"}/><Summary label="Lowest point" value={formatMoney(forecast.lowestBalanceMinor,currency)} detail={formatDate(forecast.lowestBalanceDate)} tone={forecast.lowestBalanceMinor<0?"negative":"warning"}/><Summary label="Planned outflow" value={formatMoney(forecast.totalOutflowsMinor,currency)} detail={`${formatMoney(forecast.budgetReserveMinor,currency)} from budget plans`} tone="negative"/></div>
      <section className="panel forecast-chart"><div className="panel-heading"><div><h2>Projected cash path</h2><p>{scenarioCopy[scenario].detail}</p></div>{loading?<span className="forecast-loading">Refreshing…</span>:forecast.lowestBalanceMinor<0?<span className="forecast-warning"><TrendingDown size={14}/> Cash falls below zero</span>:<span className="forecast-safe"><ShieldCheck size={14}/> Stays above zero</span>}</div><BalanceChart forecast={forecast}/></section>
      <div className="forecast-grid"><section className="panel"><div className="panel-heading"><div><h2>Cash accounts</h2><p>Current balances included in this {currency} forecast</p></div><TrendingUp size={18}/></div>{cashAccounts.map(item=><div className="forecast-account" key={item.id}><span>{item.name}<small>{item.ownerLabel}</small></span><strong className={item.balanceMinor<0?"negative":""}>{formatMoney(item.balanceMinor,item.currency)}</strong></div>)}</section><section className="panel"><div className="panel-heading"><div><h2>Projection checkpoints</h2><p>Days with scheduled activity or month boundaries</p></div><CalendarRange size={18}/></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Balance</th></tr></thead><tbody>{checkpoints(forecast).map(day=><tr key={day.date}><td>{formatDate(day.date)}</td><td className="positive">{day.inflowMinor?formatMoney(day.inflowMinor,currency):"—"}</td><td className="negative">{day.outflowMinor?formatMoney(day.outflowMinor,currency):"—"}</td><td className={day.balanceMinor<0?"negative":""}><strong>{formatMoney(day.balanceMinor,currency)}</strong></td></tr>)}</tbody></table></div></section></div>
      <p className="forecast-note">Forecasts are estimates, not ledger entries. Household cash includes budget-plan spending; single-account views use that account’s scheduled activity only because budgets are not assigned to accounts. Budget rollover remains reserved cash. Transfers within the selected cash scope are neutral; transfers crossing its boundary appear as exact inflows or outflows.</p>
    </>}
  </div>;
}

function Summary({label,value,detail,tone=""}:{label:string;value:string;detail:string;tone?:string}){return <article className={`summary ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;}
function checkpoints(forecast:CashFlowForecast){return forecast.days.filter((item,index)=>item.scheduledCount>0||item.date.slice(8)==="01"||index===forecast.days.length-1).slice(0,14);}
function BalanceChart({forecast}:{forecast:CashFlowForecast}){
  const width=900,height=210,pad=18,values=forecast.days.map(item=>item.balanceMinor),min=Math.min(0,...values),max=Math.max(0,...values),range=Math.max(1,max-min);
  const x=(index:number)=>pad+(index/Math.max(1,values.length-1))*(width-pad*2),y=(value:number)=>pad+(max-value)/range*(height-pad*2),points=values.map((value,index)=>`${x(index)},${y(value)}`).join(" ");
  return <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${forecast.horizonDays}-day cash balance projection`}><line className="zero-line" x1={pad} x2={width-pad} y1={y(0)} y2={y(0)}/><polyline className={forecast.lowestBalanceMinor<0?"forecast-line danger":"forecast-line"} points={points}/><circle cx={x(values.length-1)} cy={y(values.at(-1)??0)} r="5"/></svg><div className="chart-labels"><span>{formatDate(forecast.days[0].date)}</span><span>{formatDate(forecast.days.at(-1)!.date)}</span></div></div>;
}
