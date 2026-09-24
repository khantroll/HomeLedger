import { describe, expect, it } from "vitest";
import { DemoFinanceRepository } from "./demoRepository";
import { ATTACHMENT_MAX_BYTES } from "./domain";

function toBase64(text: string): string {
  return btoa(text);
}

describe("transaction attachments", () => {
  it("attaches one and multiple documents to a transaction without changing balances", async () => {
    const repository = new DemoFinanceRepository();
    const before = (await repository.listAccounts()).find((item) => item.id === "checking")!.balanceMinor;
    const created = await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-09-22",
      payee: "Office Supply",
      category: "Office",
      amountMinor: -1200,
      status: "cleared",
    });

    const first = await repository.attachBytesToTransaction({
      transactionId: created.id,
      originalFilename: "receipt.txt",
      contentBase64: toBase64("receipt-one"),
    });
    const second = await repository.attachBytesToTransaction({
      transactionId: created.id,
      originalFilename: "invoice.csv",
      contentBase64: toBase64("invoice,amount\n1,12.00"),
    });
    expect(first.id).not.toBe(second.id);
    expect(first.storageKey).not.toBe("receipt.txt");
    expect(first.originalFilename).toBe("receipt.txt");
    expect(first.byteSize).toBe("receipt-one".length);

    const listed = await repository.listTransactionAttachments(created.id);
    expect(listed).toHaveLength(2);
    expect(listed.map((item) => item.originalFilename).sort()).toEqual(["invoice.csv", "receipt.txt"]);

    const page = await repository.listTransactionsPage({ accountId: "checking", newest: true });
    expect(page.transactions.find((item) => item.id === created.id)?.attachmentCount).toBe(2);

    const after = (await repository.listAccounts()).find((item) => item.id === "checking")!.balanceMinor;
    expect(after).toBe(before - 1200);

    await repository.detachTransactionAttachment(created.id, first.id);
    expect(await repository.listTransactionAttachments(created.id)).toHaveLength(1);
    const afterDetach = (await repository.listAccounts()).find((item) => item.id === "checking")!.balanceMinor;
    expect(afterDetach).toBe(after);
  });

  it("shares one attachment across transactions and cleans up only after the last reference", async () => {
    const repository = new DemoFinanceRepository();
    const a = await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-09-22",
      payee: "A",
      category: "Misc",
      amountMinor: -100,
      status: "cleared",
    });
    const b = await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-09-22",
      payee: "B",
      category: "Misc",
      amountMinor: -200,
      status: "cleared",
    });
    const payload = toBase64("shared-bytes");
    const first = await repository.attachBytesToTransaction({
      transactionId: a.id,
      originalFilename: "shared.txt",
      contentBase64: payload,
    });
    const second = await repository.attachBytesToTransaction({
      transactionId: b.id,
      originalFilename: "shared-copy.txt",
      contentBase64: payload,
    });
    expect(second.id).toBe(first.id);

    await repository.detachTransactionAttachment(a.id, first.id);
    expect(await repository.listTransactionAttachments(a.id)).toHaveLength(0);
    expect(await repository.listTransactionAttachments(b.id)).toHaveLength(1);
    await expect(repository.openAttachment(first.id)).resolves.toBeUndefined();

    await repository.detachTransactionAttachment(b.id, first.id);
    await expect(repository.openAttachment(first.id)).rejects.toThrow(/does not exist/i);
  });

  it("rejects unsupported types and oversized payloads", async () => {
    const repository = new DemoFinanceRepository();
    const created = await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-09-22",
      payee: "Bad",
      category: "Misc",
      amountMinor: -50,
      status: "cleared",
    });
    await expect(
      repository.attachBytesToTransaction({
        transactionId: created.id,
        originalFilename: "malware.exe",
        contentBase64: toBase64("nope"),
      }),
    ).rejects.toThrow(/Unsupported attachment type/i);

    const oversized = "x".repeat(ATTACHMENT_MAX_BYTES + 1);
    await expect(
      repository.attachBytesToTransaction({
        transactionId: created.id,
        originalFilename: "huge.txt",
        contentBase64: toBase64(oversized),
      }),
    ).rejects.toThrow(/10 MB/i);
  });

  it("keeps original filename metadata while using an opaque storage key", async () => {
    const repository = new DemoFinanceRepository();
    const created = await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-09-22",
      payee: "Path",
      category: "Misc",
      amountMinor: -10,
      status: "cleared",
    });
    const attached = await repository.attachBytesToTransaction({
      transactionId: created.id,
      originalFilename: "reports\\sept\\receipt.txt",
      contentBase64: toBase64("sept-receipt"),
    });
    expect(attached.originalFilename).toBe("reports_sept_receipt.txt");
    expect(attached.storageKey).not.toBe(attached.originalFilename);
    expect(attached.storageKey).not.toContain("/");
    expect(attached.storageKey).not.toContain("\\");
  });

  it("retains an import source once for multiple transactions and undoes when unreferenced", async () => {
    const repository = new DemoFinanceRepository();
    const imported = await repository.importTransactions({
      accountId: "checking",
      sourceName: "statement.csv",
      rows: [
        { postedDate: "2026-09-23", payee: "Store A", amountMinor: -1100, externalId: "att-a" },
        { postedDate: "2026-09-23", payee: "Store B", amountMinor: -2200, externalId: "att-b" },
      ],
      retainSource: {
        originalFilename: "statement.csv",
        contentBase64: toBase64("date,payee,amount\n2026-09-23,Store A,-11.00\n2026-09-23,Store B,-22.00"),
      },
    });
    expect(imported.transactionIds).toHaveLength(2);
    const retainedId = (await repository.listTransactionAttachments(imported.transactionIds[0]))[0].id;
    for (const id of imported.transactionIds) {
      const links = await repository.listTransactionAttachments(id);
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe(retainedId);
      expect(links[0].sourceKind).toBe("import_retention");
    }
    const listed = await repository.listTransactions("checking");
    expect(listed.find((item) => item.id === imported.transactionIds[0])?.attachmentCount).toBe(1);

    await repository.undoImportBatch(imported.batchId);
    await expect(repository.openAttachment(retainedId)).rejects.toThrow(/does not exist/i);
  });

  it("keeps a shared attachment after undo when independently attached elsewhere", async () => {
    const repository = new DemoFinanceRepository();
    const payload = toBase64("same-source-bytes");
    const imported = await repository.importTransactions({
      accountId: "checking",
      sourceName: "keep.csv",
      rows: [{ postedDate: "2026-09-24", payee: "Keep Me", amountMinor: -500, externalId: "keep-1" }],
      retainSource: {
        originalFilename: "keep.csv",
        contentBase64: payload,
      },
    });
    const retainedId = (await repository.listTransactionAttachments(imported.transactionIds[0]))[0].id;
    const manual = await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-09-24",
      payee: "Manual",
      category: "Misc",
      amountMinor: -25,
      status: "cleared",
    });
    const linked = await repository.attachBytesToTransaction({
      transactionId: manual.id,
      originalFilename: "keep-copy.csv",
      contentBase64: payload,
    });
    expect(linked.id).toBe(retainedId);

    await repository.undoImportBatch(imported.batchId);
    expect(await repository.listTransactionAttachments(manual.id)).toHaveLength(1);
    await expect(repository.openAttachment(retainedId)).resolves.toBeUndefined();
  });

  it("rolls back the whole import when retainSource fails validation", async () => {
    const repository = new DemoFinanceRepository();
    const before = (await repository.listTransactions("checking")).length;
    await expect(
      repository.importTransactions({
        accountId: "checking",
        sourceName: "bad.exe",
        rows: [{ postedDate: "2026-09-26", payee: "Nope", amountMinor: -100, externalId: "bad-retain" }],
        retainSource: {
          originalFilename: "bad.exe",
          contentBase64: toBase64("MZ"),
        },
      }),
    ).rejects.toThrow(/unsupported/i);
    expect((await repository.listTransactions("checking")).length).toBe(before);
    expect((await repository.listImportBatches()).some((batch) => batch.sourceName === "bad.exe")).toBe(false);
  });

  it("exposes attachmentCount on listed transactions", async () => {
    const repository = new DemoFinanceRepository();
    const created = await repository.createTransaction({
      accountId: "checking",
      postedDate: "2026-09-25",
      payee: "Count",
      category: "Misc",
      amountMinor: -75,
      status: "cleared",
    });
    expect((await repository.listTransactions("checking")).find((item) => item.id === created.id)?.attachmentCount).toBe(0);
    await repository.attachBytesToTransaction({
      transactionId: created.id,
      originalFilename: "one.txt",
      contentBase64: toBase64("one"),
    });
    await repository.attachBytesToTransaction({
      transactionId: created.id,
      originalFilename: "two.txt",
      contentBase64: toBase64("two"),
    });
    expect((await repository.listTransactions("checking")).find((item) => item.id === created.id)?.attachmentCount).toBe(2);
    expect(
      (await repository.listTransactionsPage({ accountId: "checking", newest: true })).transactions.find((item) => item.id === created.id)
        ?.attachmentCount,
    ).toBe(2);
  });
});
