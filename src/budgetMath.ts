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

export function previousMonth(month:string):string{
  validateMonth(month);
  const [year,value]=month.split("-").map(Number),prev=value===1?[year-1,12]:[year,value-1];
  return`${prev[0]}-${String(prev[1]).padStart(2,"0")}`;
}

/** Shift a YYYY-MM budget month by a signed month offset. */
export function shiftBudgetMonth(month:string,offset:number):string{
  validateMonth(month);
  let result=month;
  if(offset>0)for(let i=0;i<offset;i++)result=nextMonth(result);
  if(offset<0)for(let i=0;i<-offset;i++)result=previousMonth(result);
  return result;
}

/**
 * Ordinary household expense for a category over [fromMonth, toMonth).
 * Matches native/demo Budget spent semantics: excludes transfers, counts only
 * outflow amounts, and attributes splits by split category.
 */
export function spendingForRange(category:string,fromMonth:string,toMonth:string,transactions:readonly Transaction[]):number{
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

/** All ordinary expense amounts in a month, keyed by normalized category label. */
export function monthlyExpenseByCategory(month:string,transactions:readonly Transaction[],eligibleAccountIds?:ReadonlySet<string>):Map<string,{category:string;spentMinor:number}>{
  validateMonth(month);
  const from=`${month}-01`,to=`${nextMonth(month)}-01`;
  const totals=new Map<string,{category:string;spentMinor:number}>();
  for(const transaction of transactions){
    if(transaction.postedDate<from||transaction.postedDate>=to||transaction.source==="transfer")continue;
    if(eligibleAccountIds&&!eligibleAccountIds.has(transaction.accountId))continue;
    if(transaction.splits?.length){
      for(const split of transaction.splits){
        if(split.amountMinor>=0)continue;
        const label=split.category.trim();if(!label)continue;
        const key=label.toLocaleLowerCase();
        const current=totals.get(key)??{category:label,spentMinor:0};
        current.spentMinor=sumMoney([current.spentMinor,-split.amountMinor]);
        totals.set(key,current);
      }
    }else if(transaction.amountMinor<0){
      const label=transaction.category.trim();if(!label)continue;
      const key=label.toLocaleLowerCase();
      const current=totals.get(key)??{category:label,spentMinor:0};
      current.spentMinor=sumMoney([current.spentMinor,-transaction.amountMinor]);
      totals.set(key,current);
    }
  }
  return totals;
}

/** Round a non-negative average of integer minor units (half-up). */
export function averageMinor(values:readonly number[]):number{
  if(!values.length)return 0;
  const sum=sumMoney([...values]);
  return Math.floor((sum+Math.floor(values.length/2))/values.length);
}
