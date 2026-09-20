/** Frontend-safe AI credential state. Secrets never round-trip after save. */
export interface AiCredentialStatus{
  accountId:string;
  configured:boolean;
}

export interface AiCredentialRepository{
  status(accountId:string):Promise<AiCredentialStatus>;
  save(accountId:string,secret:string):Promise<AiCredentialStatus>;
  clear(accountId:string):Promise<AiCredentialStatus>;
}

export function validateCredentialAccountId(accountId:string):string{
  const value=accountId.trim();
  if(!value||value.length>200)throw new Error("Provider credential account id is invalid");
  if(!/^[a-z0-9][a-z0-9:_./-]{0,198}$/i.test(value))throw new Error("Provider credential account id contains unsupported characters");
  return value;
}

export function validateCredentialSecret(secret:string):string{
  if(!secret||secret.length>4096)throw new Error("API credential length is invalid");
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(secret))throw new Error("API credential contains control characters");
  return secret;
}

/** Pure helper proving secrets are stripped from any accidental object dumps. */
export function redactCredentialFields<T extends Record<string,unknown>>(value:T):T{
  const blocked=new Set(["secret","apiKey","api_key","password","token","authorization","credential","credentials"]);
  const result:Record<string,unknown>={};
  for(const [key,child] of Object.entries(value)){
    if(blocked.has(key))result[key]="[redacted]";
    else if(child&&typeof child==="object"&&!Array.isArray(child))result[key]=redactCredentialFields(child as Record<string,unknown>);
    else result[key]=child;
  }
  return result as T;
}
