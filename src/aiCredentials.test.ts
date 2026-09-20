import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {redactCredentialFields,validateCredentialAccountId,validateCredentialSecret} from "./aiCredentials";
import {providerAdapterContract} from "./aiProvider";

describe("AI credential safety",()=>{
  it("validates vault account ids and secrets without retaining them in redacted dumps",()=>{
    expect(validateCredentialAccountId("cloud:openai:default")).toBe("cloud:openai:default");
    expect(()=>validateCredentialAccountId("bad id")).toThrow(/unsupported/i);
    expect(validateCredentialSecret("sk-test-secret")).toBe("sk-test-secret");
    expect(()=>validateCredentialSecret("")).toThrow(/length/i);
    const redacted=redactCredentialFields({accountId:"cloud:openai:default",apiKey:"sk-live",secret:"raw",model:"gpt"});
    expect(redacted.apiKey).toBe("[redacted]");
    expect(redacted.secret).toBe("[redacted]");
    expect(redacted.accountId).toBe("cloud:openai:default");
    expect(JSON.stringify(redacted)).not.toContain("sk-live");
  });

  it("keeps credential vault commands and AI adapters off the finance repository surface",()=>{
    const repositorySource=readFileSync(new URL("./repository.ts",import.meta.url),"utf8");
    expect(repositorySource).toMatch(/set_ai_provider_credential/);
    expect(repositorySource).toMatch(/ai_provider_credential_status/);
    expect(repositorySource).toMatch(/query_local_ai/);
    expect(repositorySource).not.toMatch(/get_ai_provider_credential|getPassword|get_password/);
    const adapterSource=readFileSync(new URL("./../src-tauri/src/lib.rs",import.meta.url),"utf8");
    expect(adapterSource).toMatch(/AI_CREDENTIAL_SERVICE/);
    expect(adapterSource).toMatch(/keyring::Entry/);
    expect(adapterSource).toMatch(/query_local_ai/);
    const queryFn=adapterSource.match(/async fn query_local_ai\([^)]*\)[^\{]*\{/)?.[0]??"";
    expect(queryFn).toContain("LocalAiRequest");
    expect(queryFn).not.toContain("DbState");
    expect(adapterSource).not.toMatch(/get_ai_provider_secret|return Ok\(secret\)/);
    expect(providerAdapterContract().mayMutateLedger).toBe(false);
  });
});
