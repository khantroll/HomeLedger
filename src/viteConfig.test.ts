import {describe,expect,it} from "vitest";
import config,{CARGO_TARGET_WATCH_IGNORE} from "../vite.config";

describe("Vite native-development watcher",()=>{
  it("ignores Cargo build output without disabling frontend watching",()=>{
    expect(CARGO_TARGET_WATCH_IGNORE).toBe("**/src-tauri/target/**");
    expect(config).toMatchObject({
      server:{
        port:1420,
        strictPort:true,
        watch:{ignored:["**/src-tauri/target/**"]}
      }
    });
    expect(config.server?.watch).not.toBeNull();
  });
});
