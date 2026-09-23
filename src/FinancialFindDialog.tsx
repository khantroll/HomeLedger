import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { Account, ScheduledTransaction, Security, Transaction } from "./domain";
import { financialFind, groupFinancialFindResults, type FinancialFindResult } from "./financialFind";
import "./financialFind.css";

export function FinancialFindDialog({accounts,transactions,schedules,securities,securityAccountIds,onClose,onSelect}:{accounts:Account[];transactions:Transaction[];schedules:ScheduledTransaction[];securities:Security[];securityAccountIds?:ReadonlyMap<string,string>;onClose:()=>void;onSelect:(result:FinancialFindResult)=>void;}){
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState(0);
  const inputRef=useRef<HTMLInputElement>(null);
  const results=useMemo(()=>financialFind(query,{accounts,transactions,schedules,securities,securityAccountIds}),[query,accounts,transactions,schedules,securities,securityAccountIds]);
  const groups=useMemo(()=>groupFinancialFindResults(results),[results]);
  const visibleResults=useMemo(()=>groups.flatMap(group=>group.results),[groups]);
  useEffect(()=>{inputRef.current?.focus();},[]);
  useEffect(()=>setSelected(0),[query]);
  function keyDown(event:React.KeyboardEvent){
    if(event.key==="Escape"){event.preventDefault();onClose();return;}
    if(event.key==="ArrowDown"&&visibleResults.length){event.preventDefault();setSelected(i=>(i+1)%visibleResults.length);}
    if(event.key==="ArrowUp"&&visibleResults.length){event.preventDefault();setSelected(i=>(i-1+visibleResults.length)%visibleResults.length);}
    if(event.key==="Enter"&&visibleResults[selected]){event.preventDefault();onSelect(visibleResults[selected]);}
  }
  return <div className="financial-find-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="financial-find" role="dialog" aria-modal="true" aria-labelledby="financial-find-title" onKeyDown={keyDown}>
      <div className="financial-find-header"><div><strong id="financial-find-title">Financial Find</strong><small>Find something you remember about your money</small></div><button onClick={onClose} aria-label="Close Financial Find"><X size={17}/></button></div>
      <label className="financial-find-input"><Search size={16}/><input ref={inputRef} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Payee, category, account, bill, or security…" aria-label="Search your financial records"/></label>
      <div className="financial-find-results" role="listbox" aria-label="Financial Find results">
        {!query.trim()?<div className="financial-find-empty">Start typing to search local HomeLedger data.</div>:results.length===0?<div className="financial-find-empty">No financially relevant matches.</div>:groups.map(group=><section key={group.kind} className="financial-find-group"><h3>{group.label}</h3>{group.results.map(result=>{const index=visibleResults.indexOf(result);return <button type="button" role="option" aria-selected={index===selected} className={index===selected?"selected":""} key={result.id} onMouseEnter={()=>setSelected(index)} onClick={()=>onSelect(result)}><span><strong>{result.title}</strong><small>{result.detail}</small></span><span className="financial-find-meta">{result.meta}{result.archived?" · Historical":""}</span></button>;})}</section>)}
      </div>
      <footer><span>↑↓ select · Enter open · Esc close</span><span>Local search only</span></footer>
    </section>
  </div>;
}
