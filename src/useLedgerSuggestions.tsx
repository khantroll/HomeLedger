import { useEffect, useId, useState } from "react";
import { financeRepository as repository } from "./repository";

export function useLedgerSuggestions() {
  const [categories, setCategories] = useState<string[]>([]);
  const [payees, setPayees] = useState<string[]>([]);
  const categoryListId = `${useId()}-categories`;
  const payeeListId = `${useId()}-payees`;

  useEffect(() => {
    let current = true;
    void Promise.all([repository.listCategories(), repository.listPayees()])
      .then(([nextCategories, nextPayees]) => {
        if (current) {
          setCategories(nextCategories);
          setPayees(nextPayees);
        }
      })
      .catch(() => {
        // Suggestions are helpful but never block financial entry.
      });
    return () => { current = false; };
  }, []);

  return { categories, payees, categoryListId, payeeListId };
}

export function SuggestionLists({ categories, payees, categoryListId, payeeListId }: ReturnType<typeof useLedgerSuggestions>) {
  return <>
    <datalist id={categoryListId}>{categories.map(value => <option value={value} key={value} />)}</datalist>
    <datalist id={payeeListId}>{payees.map(value => <option value={value} key={value} />)}</datalist>
  </>;
}
