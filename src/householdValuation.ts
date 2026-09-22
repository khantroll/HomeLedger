import type {Account,PortfolioSnapshot} from "./domain";

export interface HouseholdCurrencyValuation{
 currency:string;
 availableCashMinor:number;
 ordinaryAssetsMinor:number;
 investmentKnownMinor:number;
 assetsKnownMinor:number;
 liabilitiesMinor:number;
 netWorthKnownMinor:number;
 incompleteInvestment:boolean;
 unvaluedHoldingCount:number;
}

export function householdCurrencies(accounts:readonly Account[]):string[]{
 return [...new Set(accounts.filter(a=>!a.archived).map(a=>a.currency))].sort();
}

export function calculateHouseholdValuation(accounts:readonly Account[],snapshot:PortfolioSnapshot|undefined,currency:string):HouseholdCurrencyValuation{
 const active=accounts.filter(a=>!a.archived&&a.currency===currency);
 const ordinary=active.filter(a=>a.type!=="investment");
 const investments=new Set(active.filter(a=>a.type==="investment").map(a=>a.id));
 const availableCashMinor=sum(ordinary.filter(a=>["checking","savings","cash"].includes(a.type)&&a.balanceMinor>0).map(a=>a.balanceMinor));
 const ordinaryAssetsMinor=sum(ordinary.filter(a=>a.balanceMinor>0).map(a=>a.balanceMinor));
 const liabilitiesMinor=sum(ordinary.filter(a=>a.balanceMinor<0).map(a=>a.balanceMinor));
 let investmentKnownMinor=0,unvaluedHoldingCount=0;
 const snapshots=new Map((snapshot?.accounts??[]).map(a=>[a.accountId,a]));
 for(const id of investments){
  const account=snapshots.get(id);
  if(!account){unvaluedHoldingCount++;continue;}
  investmentKnownMinor=add(investmentKnownMinor,account.cashMinor);
  for(const holding of account.holdings){
   if(holding.quantityE8===0)continue;
   if(holding.marketValueMinor===undefined)unvaluedHoldingCount++;
   else investmentKnownMinor=add(investmentKnownMinor,holding.marketValueMinor);
  }
 }
 const assetsKnownMinor=add(ordinaryAssetsMinor,investmentKnownMinor);
 return{currency,availableCashMinor,ordinaryAssetsMinor,investmentKnownMinor,assetsKnownMinor,liabilitiesMinor,netWorthKnownMinor:add(assetsKnownMinor,liabilitiesMinor),incompleteInvestment:unvaluedHoldingCount>0,unvaluedHoldingCount};
}
function sum(values:number[]){return values.reduce((a,b)=>add(a,b),0)}
function add(a:number,b:number){const n=a+b;if(!Number.isSafeInteger(n))throw new Error("Household valuation is too large");return n}
