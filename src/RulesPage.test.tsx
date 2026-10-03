// @vitest-environment jsdom
import {cleanup,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,describe,expect,it,vi} from "vitest";
import {RulesPage} from "./RulesPage";
import * as repositoryModule from "./repository";
import type {MerchantRule} from "./domain";

afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe("merchant rule management",()=>{
  it("shows rule origin and preserves it while editing",async()=>{
    const user=userEvent.setup();
    const remembered:MerchantRule={id:"r1",name:"Remember ARKANSAS VALLEY",pattern:"ARKANSAS VALLEY",matchType:"exact",direction:"expense",renameTo:"Arkansas Valley Electric",category:"Utilities: Electric",priority:1000,enabled:true,origin:"remembered"};
    vi.spyOn(repositoryModule.financeRepository,"listMerchantRules").mockResolvedValue([remembered]);
    vi.spyOn(repositoryModule.financeRepository,"listPayees").mockResolvedValue(["Arkansas Valley Electric"]);
    vi.spyOn(repositoryModule.financeRepository,"listCategories").mockResolvedValue(["Utilities: Electric"]);
    const update=vi.spyOn(repositoryModule.financeRepository,"updateMerchantRule").mockResolvedValue({...remembered,matchType:"starts_with"});
    render(<RulesPage/>);
    expect(await screen.findByText("Remembered correction")).toBeTruthy();
    await user.click(screen.getByRole("button",{name:/Edit/i}));
    await user.selectOptions(screen.getByLabelText("Match type"),"starts_with");
    await user.click(screen.getByRole("button",{name:"Save rule"}));
    await waitFor(()=>expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({matchType:"starts_with",origin:"remembered"});
  });

  it("can delete a saved custom rule after confirmation",async()=>{
    const user=userEvent.setup();
    const custom:MerchantRule={id:"r2",name:"PayPal",pattern:"PAYPAL",matchType:"starts_with",direction:"expense",renameTo:"PayPal",priority:100,enabled:true,origin:"manual"};
    vi.spyOn(repositoryModule.financeRepository,"listMerchantRules").mockResolvedValue([custom]);
    vi.spyOn(repositoryModule.financeRepository,"listPayees").mockResolvedValue(["PayPal"]);
    vi.spyOn(repositoryModule.financeRepository,"listCategories").mockResolvedValue([]);
    const remove=vi.spyOn(repositoryModule.financeRepository,"deleteMerchantRule").mockResolvedValue(undefined);
    render(<RulesPage/>);
    expect(await screen.findByText("Custom rule")).toBeTruthy();
    await user.click(screen.getByRole("button",{name:/Edit/i}));
    await user.click(screen.getByRole("button",{name:"Delete rule"}));
    await user.click(screen.getByRole("button",{name:"Confirm rule deletion"}));
    await waitFor(()=>expect(remove).toHaveBeenCalledWith("r2"));
  });
});
