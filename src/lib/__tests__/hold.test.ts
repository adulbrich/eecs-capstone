import { describe, expect, it } from "vitest";
import {
  formatHoldDetailed,
  formatHoldShort,
  type Hold,
  holdFromInput,
  holdFromJoinedRow,
  holdFromStoredRow,
  holdToColumns,
} from "../hold";

const NO_ACCOUNT = { accountId: null, accountName: null };

describe("holdFromInput", () => {
  it("builds a walk-in hold from an address with no account", () => {
    expect(
      holdFromInput(
        { email: "walk@in.test", name: "Wanda", program: "ECE" },
        NO_ACCOUNT
      )
    ).toEqual({
      kind: "walk_in",
      email: "walk@in.test",
      name: "Wanda",
      program: "ECE",
    });
  });

  it("builds an account hold, and the typed name has nowhere to go", () => {
    const hold = holdFromInput(
      { email: "has@account.test", name: "Typed", program: "ECE" },
      { accountId: "u-1", accountName: "Real Name" }
    );
    expect(hold).toEqual({
      kind: "account",
      accountId: "u-1",
      email: "has@account.test",
      name: "Real Name",
    });
    expect(hold).not.toHaveProperty("program");
  });

  it("builds a thing hold from a label alone", () => {
    expect(holdFromInput({ label: "Cart 3" }, NO_ACCOUNT)).toEqual({
      kind: "thing",
      label: "Cart 3",
    });
  });

  it("builds no hold from nothing", () => {
    expect(holdFromInput({}, NO_ACCOUNT)).toEqual({ kind: "none" });
  });

  it("throws when a hold is on a person and a thing at once", () => {
    expect(() =>
      holdFromInput({ email: "a@b.test", label: "Cart 3" }, NO_ACCOUNT)
    ).toThrow(/not both/i);
  });

  it("ignores a name or program supplied without an address", () => {
    expect(
      holdFromInput(
        { label: "Cart 3", name: "Wanda", program: "ECE" },
        NO_ACCOUNT
      )
    ).toEqual({ kind: "thing", label: "Cart 3" });
  });

  it("treats a blank address as absent", () => {
    expect(
      holdFromInput({ email: "   ", label: "Cart 3" }, NO_ACCOUNT)
    ).toEqual({
      kind: "thing",
      label: "Cart 3",
    });
  });
});

describe("holdToColumns", () => {
  it("writes a walk-in's name and program", () => {
    expect(
      holdToColumns({
        kind: "walk_in",
        email: "walk@in.test",
        name: "Wanda",
        program: "ECE",
      })
    ).toEqual({
      currentHolderId: null,
      currentHolderEmail: "walk@in.test",
      currentHolderLabel: null,
      currentHolderName: "Wanda",
      currentHolderProgram: "ECE",
    });
  });

  it("never stores an account's name, because the account is authoritative", () => {
    expect(
      holdToColumns({
        kind: "account",
        accountId: "u-1",
        email: "has@account.test",
        name: "Real Name",
      })
    ).toEqual({
      currentHolderId: "u-1",
      currentHolderEmail: "has@account.test",
      currentHolderLabel: null,
      currentHolderName: null,
      currentHolderProgram: null,
    });
  });

  it("clears every column for no hold", () => {
    expect(holdToColumns({ kind: "none" })).toEqual({
      currentHolderId: null,
      currentHolderEmail: null,
      currentHolderLabel: null,
      currentHolderName: null,
      currentHolderProgram: null,
    });
  });

  it("round-trips a thing hold", () => {
    const hold: Hold = { kind: "thing", label: "Cart 3" };
    expect(holdFromStoredRow(holdToColumns(hold))).toEqual(hold);
  });
});

describe("holdFromJoinedRow", () => {
  const stored = {
    currentHolderId: "u-1",
    currentHolderEmail: "old@address.test",
    currentHolderLabel: null,
    currentHolderName: null,
    currentHolderProgram: null,
  };

  it("the joined account's address wins over the stored one", () => {
    expect(
      holdFromJoinedRow(stored, {
        accountEmail: "new@address.test",
        accountName: "Renamed",
      })
    ).toEqual({
      kind: "account",
      accountId: "u-1",
      email: "new@address.test",
      name: "Renamed",
    });
  });

  it("falls back to the stored address when no account joined", () => {
    expect(
      holdFromJoinedRow(
        { ...stored, currentHolderId: null, currentHolderName: "Wanda" },
        { accountEmail: null, accountName: null }
      )
    ).toEqual({
      kind: "walk_in",
      email: "old@address.test",
      name: "Wanda",
      program: null,
    });
  });
});

describe("holdFromStoredRow", () => {
  it("does not invent an account name it was never given", () => {
    expect(
      holdFromStoredRow({
        currentHolderId: "u-1",
        currentHolderEmail: "has@account.test",
        currentHolderLabel: null,
        currentHolderName: null,
        currentHolderProgram: null,
      })
    ).toEqual({
      kind: "account",
      accountId: "u-1",
      email: "has@account.test",
      name: null,
    });
  });
});

describe("formatHoldShort", () => {
  it("prefers name, then address, then label", () => {
    expect(
      formatHoldShort({
        kind: "account",
        accountId: "u-1",
        email: "a@b.test",
        name: "Ada",
      })
    ).toBe("Ada");
    expect(
      formatHoldShort({
        kind: "account",
        accountId: "u-1",
        email: "a@b.test",
        name: null,
      })
    ).toBe("a@b.test");
    expect(formatHoldShort({ kind: "thing", label: "Cart 3" })).toBe("Cart 3");
    expect(formatHoldShort({ kind: "none" })).toBeNull();
  });

  it("omits the program a walk-in carries", () => {
    expect(
      formatHoldShort({
        kind: "walk_in",
        email: "w@in.test",
        name: "Wanda",
        program: "ECE",
      })
    ).toBe("Wanda");
  });
});

describe("formatHoldDetailed", () => {
  it("renders a named person as name and address", () => {
    expect(
      formatHoldDetailed({
        kind: "account",
        accountId: "u-1",
        email: "a@b.test",
        name: "Ada",
      })
    ).toBe("Ada (a@b.test)");
  });

  it("renders an unnamed person as the address alone", () => {
    expect(
      formatHoldDetailed({
        kind: "walk_in",
        email: "w@in.test",
        name: null,
        program: null,
      })
    ).toBe("w@in.test");
  });

  it("appends a walk-in's program", () => {
    expect(
      formatHoldDetailed({
        kind: "walk_in",
        email: "w@in.test",
        name: "Wanda",
        program: "ECE",
      })
    ).toBe("Wanda (w@in.test) · ECE");
  });

  it("renders a thing as its label, with no program suffix", () => {
    expect(formatHoldDetailed({ kind: "thing", label: "Cart 3" })).toBe(
      "Cart 3"
    );
  });

  it("renders no hold as null", () => {
    expect(formatHoldDetailed({ kind: "none" })).toBeNull();
  });
});
