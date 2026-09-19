import {sumMoney,type BudgetAllocation,type BudgetCategory,type BudgetMonth,type Transaction} from "./domain";

export function calculateBudgetMonth(month:string,categories:readonly BudgetCategory[],allocations:readonly BudgetAllocation[],transactions:readonly Transaction[]):BudgetMonth{
  validateMonth(month);
  const lines=categories.map(category=>{
    const categoryAllocations=allocations.filter(item=>item.budgetCategoryId===category.id);
    const plannedMinor=categoryAllocations.find(item=>item.month===month)?.plannedMinor??0;
    const earliest=categoryAllocations.map(item=>item.month).sort()[0];
    const carryInMinor=category.rolloverEnabled&&earliest&&earliest<month
      ?sumMoney(categoryAllocations.filter(item=>item.month<month).map(item=>item.plannedMinor))-spendingForRange(category.category,earliest,month,transactions)
      :0;
    const spentMinor=spendingForRange(category.category,month,nextMonth(month),transactions);
    return{...category,plannedMinor,spentMinor,carryInMinor,availableMinor:sumMoney([plannedMinor,carryInMinor,-spentMinor])};
  }).sort((a,b)=>a.category.localeCompare(b.category));
  return{month,plannedMinor:sumMoney(lines.map(item=>item.plannedMinor)),spentMinor:sumMoney(lines.map(item=>item.spentMinor)),carryInMinor:sumMoney(lines.map(item=>item.carryInMinor)),availableMinor:sumMoney(lines.map(item=>item.availableMinor)),lines};
}

export function validateMonth(month:string):void{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error("Budget month must use YYYY-MM");
}

export function nextMonth(month:string):string{
  validateMonth(month);
  const [year,value]=month.split("-").map(Number),next=value===12?[year+1,1]:[year,value+1];
  return`${next[0]}-${String(next[1]).padStart(2,"0")}`;
}

function spendingForRange(category:string,fromMonth:string,toMonth:string,transactions:readonly Transaction[]):number{
  const normalized=category.trim().toLocaleLowerCase(),from=`${fromMonth}-01`,to=`${toMonth}-01`;
  const values:number[]=[];
  for(const transaction of transactions){
    if(transaction.postedDate<from||transaction.postedDate>=to||transaction.source==="transfer")continue;
    if(transaction.splits?.length){
      for(const split of transaction.splits)if(split.amountMinor<0&&split.category.trim().toLocaleLowerCase()===normalized)values.push(-split.amountMinor);
    }else if(transaction.amountMinor<0&&transaction.category.trim().toLocaleLowerCase()===normalized)values.push(-transaction.amountMinor);
  }
  return sumMoney(values);
}
