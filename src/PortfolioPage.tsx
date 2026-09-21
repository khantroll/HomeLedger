import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BriefcaseBusiness } from "lucide-react";
import { formatMoney, type Account, type PortfolioSnapshot, type Security } from "./domain";
import { investmentRepository, isNativeApp } from "./repository";
import { todayIso } from "./scheduledPresentation";
import "./portfolio.css";

export interface PortfolioNavigationFocus { accountId?: string; securityId?: string; }

function formatQuantity(valueE8:number):string {
  return new Intl.NumberFormat("en-US",{maximumFractionDigits:8}).format(valueE8/100_000_000);
}
function formatPrice(valueE8:number|undefined,currency:string):string {
  if(valueE8===undefined)return "Price needed";
  return new Intl.NumberFormat("en-US",{style:"currency",currency,maximumFractionDigits:4}).format(valueE8/100_000_000);
}
function priceDate(value:string|undefined):string {
  if(!value)return "No local price";
  const date=value.slice(0,10);
  return new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeZone:"UTC"}).format(new Date(`${date}T00:00:00Z`));
}

export function PortfolioPage({accounts,focus,onShowAll,onOpenSecurity}:{accounts:Account[];focus?:PortfolioNavigationFocus;onShowAll:()=>void;onOpenSecurity:(accountId:string,securityId:string)=>void;}) {
  const investmentAccounts=useMemo(()=>accounts.filter(a=>a.type==="investment"&&!a.archived),[accounts]);
  const scopedAccounts=useMemo(()=>focus?.accountId?investmentAccounts.filter(a=>a.id===focus.accountId):investmentAccounts,[investmentAccounts,focus?.accountId]);
  const [snapshot,setSnapshot]=useState<PortfolioSnapshot>();
  const [securities,setSecurities]=useState<Security[]>([]);
  const [error,setError]=useState("");
  const asOfDate=todayIso();

  useEffect(()=>{
    let cancelled=false;
    if(!isNativeApp){setSnapshot(undefined);setSecurities([]);setError("");return ()=>{cancelled=true;};}
    if(scopedAccounts.length===0){setSnapshot({asOfDate,accounts:[]});setSecurities([]);setError("");return ()=>{cancelled=true;};}
    void Promise.all([
      investmentRepository.calculatePortfolioSnapshot(scopedAccounts.map(a=>a.id),asOfDate),
      investmentRepository.listSecurities(false),
    ]).then(([nextSnapshot,nextSecurities])=>{if(!cancelled){setSnapshot(nextSnapshot);setSecurities(nextSecurities);setError("");}})
      .catch(reason=>{if(!cancelled)setError(reason instanceof Error?reason.message:String(reason));});
    return ()=>{cancelled=true;};
  },[asOfDate,scopedAccounts.map(a=>a.id).join("|")]);

  const securityById=useMemo(()=>new Map(securities.map(s=>[s.id,s])),[securities]);
  const accountById=useMemo(()=>new Map(investmentAccounts.map(a=>[a.id,a])),[investmentAccounts]);
  const rows=useMemo(()=>snapshot?.accounts.flatMap(a=>a.holdings.map(h=>({account:a,holding:h})))??[],[snapshot]);
  const cashMinor=useMemo(()=>snapshot?.accounts.reduce((sum,a)=>sum+a.cashMinor,0)??0,[snapshot]);
  const investmentsKnown=snapshot!==undefined&&snapshot.accounts.every(a=>a.holdingsValueMinor!==undefined);
  const investmentsMinor=investmentsKnown?snapshot!.accounts.reduce((sum,a)=>sum+(a.holdingsValueMinor??0),0):undefined;
  const totalKnown=snapshot!==undefined&&snapshot.accounts.every(a=>a.totalValueMinor!==undefined);
  const totalMinor=totalKnown?snapshot!.accounts.reduce((sum,a)=>sum+(a.totalValueMinor??0),0):undefined;
  const knownBasisMinor=rows.reduce((sum,row)=>sum+row.holding.knownBasisMinor,0);
  const gainRows=rows.filter(row=>row.holding.unrealizedGainMinor!==undefined);
  const gainMinor=gainRows.reduce((sum,row)=>sum+(row.holding.unrealizedGainMinor??0),0);
  const gainComplete=rows.length>0&&gainRows.length===rows.length&&rows.every(row=>!row.holding.incompleteUnknownBasis);
  const currency=scopedAccounts[0]?.currency??investmentAccounts[0]?.currency??"USD";
  const mixedCurrency=scopedAccounts.some(a=>a.currency!==currency);
  const scopedName=focus?.accountId?accountById.get(focus.accountId)?.name:undefined;

  if(!isNativeApp)return <div className="portfolio-page"><section className="panel portfolio-empty"><BriefcaseBusiness size={34}/><h2>Portfolio is available in the desktop app</h2><p>The Portfolio Manager reads your local investment Foundation and saved prices. Browser preview does not connect to that local database.</p></section></div>;

  return <div className="portfolio-page">
    {focus?.accountId&&<button className="portfolio-back" onClick={onShowAll}><ArrowLeft size={13}/> All investments</button>}
    <section className="portfolio-intro">
      <div><span className="eyebrow">{scopedName?"Investment account":"Portfolio Manager"}</span><h2>{scopedName??"Your investments at a glance"}</h2><p>What you own, what you paid, and what it is worth using prices saved on this computer.</p></div>
      <div className="portfolio-asof"><span>As of</span><strong>{priceDate(asOfDate)}</strong></div>
    </section>
    {error&&<div className="error-banner" role="alert">{error}</div>}
    {mixedCurrency&&<div className="notice"><strong>Separate currencies</strong><span>HomeLedger does not combine investment values across currencies without FX accounting.</span></div>}
    <div className="summary-grid portfolio-summary">
      <PortfolioSummary label="Portfolio value" value={!mixedCurrency&&totalMinor!==undefined?formatMoney(totalMinor,currency):"Unknown"} detail={totalMinor===undefined?"One or more holdings needs a price":"Cash plus investments"}/>
      <PortfolioSummary label="Investments" value={!mixedCurrency&&investmentsMinor!==undefined?formatMoney(investmentsMinor,currency):"Unknown"} detail={investmentsMinor===undefined?"Missing prices stay unknown":"Securities with local prices"}/>
      <PortfolioSummary label="Cash" value={!mixedCurrency?formatMoney(cashMinor,currency):"See accounts"} detail="Cash held inside investment accounts"/>
      <PortfolioSummary label="Known cost basis" value={!mixedCurrency?formatMoney(knownBasisMinor,currency):"See holdings"} detail={rows.some(r=>r.holding.incompleteUnknownBasis)?"Some basis is unknown":"Basis HomeLedger can establish"}/>
      <PortfolioSummary label="Unrealized gain/loss" value={!mixedCurrency&&gainRows.length?formatMoney(gainMinor,currency):"Unknown"} detail={gainComplete?"Calculated from known basis and prices":gainRows.length?"Partial — some gain/loss is unknown":"Needs basis and price data"} tone={gainRows.length?(gainMinor<0?"negative":"positive"):undefined}/>
    </div>
    <section className="panel portfolio-holdings">
      <div className="panel-heading"><div><h2>Holdings</h2><p>Securities are separate from cash. Missing prices and basis are never treated as zero.</p></div></div>
      {snapshot===undefined&&!error?<div className="empty-state">Loading portfolio…</div>:rows.length===0?<div className="empty-state">{investmentAccounts.length?"No securities are held in this view yet.":"Add an investment account to begin tracking a portfolio."}</div>:
      <div className="table-wrap"><table><thead><tr><th>Security</th><th>Account</th><th className="amount">Shares</th><th className="amount">Price / date</th><th className="amount">Market value</th><th className="amount">Known basis</th><th className="amount">Gain / loss</th><th className="amount">Portfolio weight</th></tr></thead>
      <tbody>{rows.map(({account,holding})=>{const security=securityById.get(holding.securityId);const accountInfo=accountById.get(holding.accountId);const basisUnknown=holding.incompleteUnknownBasis||holding.unknownBasisQuantityE8>0;const weight=investmentsMinor&&holding.marketValueMinor!==undefined?(holding.marketValueMinor/investmentsMinor)*100:undefined;return <tr key={`${holding.accountId}:${holding.securityId}`} className={focus?.securityId===holding.securityId?"portfolio-selected":undefined}>
        <td><button className="portfolio-security-link" onClick={()=>onOpenSecurity(holding.accountId,holding.securityId)}><strong>{security?.symbol??security?.name??"Unknown security"}</strong><small>{security?.symbol?security.name:"Security details"}</small></button></td>
        <td>{accountInfo?.name??"Investment account"}</td><td className="amount">{formatQuantity(holding.quantityE8)}</td>
        <td className="amount"><span className={holding.priceE8===undefined?"portfolio-unknown":undefined}>{formatPrice(holding.priceE8,accountInfo?.currency??currency)}</span><small>{priceDate(holding.priceObservedAt)}</small></td>
        <td className="amount">{holding.marketValueMinor===undefined?<span className="portfolio-unknown">Unknown</span>:formatMoney(holding.marketValueMinor,accountInfo?.currency??currency)}</td>
        <td className="amount"><span>{formatMoney(holding.knownBasisMinor,accountInfo?.currency??currency)}</span>{basisUnknown&&<small className="portfolio-unknown">Partial — basis unavailable</small>}</td>
        <td className="amount">{holding.unrealizedGainMinor===undefined?<span className="portfolio-unknown">Unknown</span>:<span className={holding.unrealizedGainMinor<0?"negative":"positive"}>{formatMoney(holding.unrealizedGainMinor,accountInfo?.currency??currency)}{basisUnknown?" (partial)":""}</span>}</td>
        <td className="amount">{weight===undefined?<span className="portfolio-unknown">Unknown</span>:`${weight.toFixed(1)}%`}</td>
      </tr>})}</tbody></table></div>}
    </section>
    {snapshot&&snapshot.accounts.length>0&&<section className="panel portfolio-cash"><div className="panel-heading"><div><h2>Cash in investment accounts</h2><p>Cash is part of account value, but it is not a security holding.</p></div></div>{snapshot.accounts.map(a=><div className="portfolio-cash-row" key={a.accountId}><span>{accountById.get(a.accountId)?.name??"Investment account"}</span><strong>{formatMoney(a.cashMinor,accountById.get(a.accountId)?.currency??currency)}</strong></div>)}</section>}
  </div>;
}
function PortfolioSummary({label,value,detail,tone}:{label:string;value:string;detail:string;tone?:"positive"|"negative"}){return <div className={`summary ${tone??""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>}
