import type { ImportProfile } from "./domain";

export type StatementSourceKind=ImportProfile["sourceKind"];

const MONTH_NAMES=new Set([
  "jan","january","feb","february","mar","march","apr","april","may","jun","june",
  "jul","july","aug","august","sep","sept","september","oct","october","nov","november","dec","december"
]);

/** Produces a stable, opaque matcher without retaining the original filename. */
export function statementSourceSignature(fileName:string):string{
  const dot=fileName.lastIndexOf("."),base=(dot>0?fileName.slice(0,dot):fileName).normalize("NFKD").replace(/([a-z])([A-Z])/g,"$1 $2").toLowerCase();
  const tokens=base.split(/[^a-z0-9]+/).filter(Boolean)
    .filter(token=>!/^\d+$/.test(token)&&!MONTH_NAMES.has(token));
  const normalized=tokens.join(" ");
  if(!normalized)return"";
  let hash=0xcbf29ce484222325n;
  for(const character of normalized){hash^=BigInt(character.codePointAt(0)!);hash=BigInt.asUintN(64,hash*0x100000001b3n);}
  return`v1-${hash.toString(16).padStart(16,"0")}`;
}

export function matchingStatementTemplate(profiles:ImportProfile[],sourceKind:StatementSourceKind,sourceSignature:string):ImportProfile|undefined{
  if(!sourceSignature)return undefined;
  return profiles.find(profile=>profile.sourceKind===sourceKind&&profile.sourceSignature===sourceSignature);
}
