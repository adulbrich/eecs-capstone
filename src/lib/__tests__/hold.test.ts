import { describe, expect, it } from "vitest";
import {
  formatHoldDetailed,
  formatHoldShort,
  type Hold,
  holdEmail,
  holdFromInput,
  holdFromJoinedRow,
  holdFromStoredRow,
  holdName,
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

  it("keeps an account resolved without an address, rather than dropping it", () => {
    // approveRequestItemAs passes a requester id and no address, and that id
    // can name an account row that no longer exists. Returning "none" here
    // would write an item into reserved with no holder at all.
    expect(holdFromInput({}, { accountId: "u-1", accountName: null })).toEqual({
      kind: "account",
      accountId: "u-1",
      email: null,
      name: null,
    });
  });

  it("builds a thing hold from a label alone", () => {
    expect(holdFromInput({ label: "Cart 3" }, NO_ACCOUNT)).toEqual({
      kind: "thing",
      label: "Cart 3",
      name: null,
      program: null,
    });
  });

  it("keeps a name and program supplied beside a label", () => {
    // transitionItemInTx stores both on this path today, and staff search
    // filters on those columns, so dropping them would lose data and make the
    // row unfindable by holder.
    expect(
      holdFromInput(
        { label: "Lab 204", name: "Robotics club", program: "CS 461" },
        NO_ACCOUNT
      )
    ).toEqual({
      kind: "thing",
      label: "Lab 204",
      name: "Robotics club",
      program: "CS 461",
    });
  });

  it("builds no hold from nothing", () => {
    expect(holdFromInput({}, NO_ACCOUNT)).toEqual({ kind: "none" });
  });

  it("throws when a hold is on an address and a thing at once", () => {
    expect(() =>
      holdFromInput({ email: "a@b.test", label: "Cart 3" }, NO_ACCOUNT)
    ).toThrow(/not both/i);
  });

  it("throws when a hold is on an account and a thing at once", () => {
    // inventory-workflow.ts counts an id and an address as one person, so the
    // constructor has to as well, or an input passes one guard and fails the
    // other.
    expect(() =>
      holdFromInput(
        { label: "Cart 3" },
        { accountId: "u-1", accountName: null }
      )
    ).toThrow(/not both/i);
  });

  it("does not trim a whitespace-only label into no hold at all", () => {
    // inventory-workflow.ts accepts this on raw truthiness, so trimming it away
    // here would let a reserved item through with all five columns null and
    // nobody to chase for it.
    expect(holdFromInput({ label: "   " }, NO_ACCOUNT)).toEqual({
      kind: "thing",
      label: "   ",
      name: null,
      program: null,
    });
  });

  it("treats an empty name or program as absent, not as a value", () => {
    // An empty string is not a value. `??` does not treat "" as absent, so an
    // empty current_holder_name would stop the admin Holder column's
    // name-then-address-then-label chain from falling through and render a
    // blank cell for an item that does have a holder.
    expect(
      holdFromInput({ email: "w@in.test", name: "", program: "" }, NO_ACCOUNT)
    ).toEqual({
      kind: "walk_in",
      email: "w@in.test",
      name: null,
      program: null,
    });
  });

  it("does not trim a whitespace-only address into no hold at all", () => {
    expect(holdFromInput({ email: "   " }, NO_ACCOUNT)).toEqual({
      kind: "walk_in",
      email: "   ",
      name: null,
      program: null,
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

  it("writes a thing's name and program alongside its label", () => {
    expect(
      holdToColumns({
        kind: "thing",
        label: "Lab 204",
        name: "Robotics club",
        program: "CS 461",
      })
    ).toEqual({
      currentHolderId: null,
      currentHolderEmail: null,
      currentHolderLabel: "Lab 204",
      currentHolderName: "Robotics club",
      currentHolderProgram: "CS 461",
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

  it("keeps an account id whose address never loaded", () => {
    expect(
      holdToColumns({
        kind: "account",
        accountId: "u-1",
        email: null,
        name: null,
      })
    ).toMatchObject({ currentHolderId: "u-1", currentHolderEmail: null });
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
    const hold: Hold = {
      kind: "thing",
      label: "Cart 3",
      name: null,
      program: null,
    };
    expect(holdFromStoredRow(holdToColumns(hold))).toEqual(hold);
  });

  it("round-trips a walk-in hold", () => {
    const hold: Hold = {
      kind: "walk_in",
      email: "w@in.test",
      name: "Wanda",
      program: "ECE",
    };
    expect(holdFromStoredRow(holdToColumns(hold))).toEqual(hold);
  });
});

describe("holdFromJoinedRow", () => {
  const accountRow = {
    currentHolderId: "u-1",
    currentHolderEmail: "old@address.test",
    currentHolderLabel: null,
    currentHolderName: "Old Name",
    currentHolderProgram: null,
  };

  it("the joined account's address and name win over the stored ones", () => {
    expect(
      holdFromJoinedRow(accountRow, {
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

  it("falls back to the stored columns when the account did not join", () => {
    // The id is still set here, so this exercises the account branch's two
    // fallbacks. A version of this test that nulls the id never reaches them.
    expect(
      holdFromJoinedRow(accountRow, { accountEmail: null, accountName: null })
    ).toEqual({
      kind: "account",
      accountId: "u-1",
      email: "old@address.test",
      name: "Old Name",
    });
  });

  it("reads an unlinked row exactly as the stored reader does", () => {
    const walkInRow = { ...accountRow, currentHolderId: null };
    expect(
      holdFromJoinedRow(walkInRow, { accountEmail: null, accountName: null })
    ).toEqual(holdFromStoredRow(walkInRow));
  });
});

describe("holdFromStoredRow", () => {
  it("reports the stored name rather than nulling it", () => {
    // storedHolderIdentity, the reader this replaces, returns
    // currentHolderName with no regard for currentHolderId. An unjoined read
    // should report what is there.
    expect(
      holdFromStoredRow({
        currentHolderId: "u-1",
        currentHolderEmail: "has@account.test",
        currentHolderLabel: null,
        currentHolderName: "Stored Name",
        currentHolderProgram: null,
      })
    ).toEqual({
      kind: "account",
      accountId: "u-1",
      email: "has@account.test",
      name: "Stored Name",
    });
  });

  it("reads no hold from five null columns", () => {
    expect(
      holdFromStoredRow({
        currentHolderId: null,
        currentHolderEmail: null,
        currentHolderLabel: null,
        currentHolderName: null,
        currentHolderProgram: null,
      })
    ).toEqual({ kind: "none" });
  });
});

describe("holdEmail and holdName", () => {
  it("read a person's address and name", () => {
    const hold: Hold = {
      kind: "walk_in",
      email: "w@in.test",
      name: "Wanda",
      program: "ECE",
    };
    expect(holdEmail(hold)).toBe("w@in.test");
    expect(holdName(hold)).toBe("Wanda");
  });

  it("give a thing a name but never an address", () => {
    // The columns behind a label hold still accept a name, and the write
    // path stores it, so a read must report it.
    const hold: Hold = {
      kind: "thing",
      label: "Lab 204",
      name: "Robotics club",
      program: "CS 461",
    };
    expect(holdEmail(hold)).toBeNull();
    expect(holdName(hold)).toBe("Robotics club");
  });

  it("give no hold neither", () => {
    expect(holdEmail({ kind: "none" })).toBeNull();
    expect(holdName({ kind: "none" })).toBeNull();
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
    expect(
      formatHoldShort({
        kind: "thing",
        label: "Cart 3",
        name: null,
        program: null,
      })
    ).toBe("Cart 3");
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

  it("prefers a thing's stored name over its label", () => {
    // The admin Holder column renders this, and listAdminInventoryAs ORs
    // over current_holder_name specifically so a staff member can read a
    // name off the table and find the row by typing it back in. Returning
    // the label here would break that pairing. Note this deliberately
    // differs from formatHoldDetailed, which renders a thing as its label.
    expect(
      formatHoldShort({
        kind: "thing",
        label: "Lab 204",
        name: "Robotics club",
        program: "CS 461",
      })
    ).toBe("Robotics club");
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
    expect(
      formatHoldDetailed({
        kind: "thing",
        label: "Cart 3",
        name: null,
        program: "CS 461",
      })
    ).toBe("Cart 3");
  });

  it("renders no hold as null", () => {
    expect(formatHoldDetailed({ kind: "none" })).toBeNull();
  });
});
