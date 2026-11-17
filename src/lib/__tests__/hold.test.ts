import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { blankText, holderText, looseHolder } from "#/test/shared/arbitraries";
import { normalizeEmailAddress } from "../email-address";
import {
  formatHoldDetailed,
  formatHoldShort,
  type Hold,
  type HoldInput,
  holdEmail,
  holdFromInput,
  holdFromJoinedRow,
  holdFromStoredRow,
  holdName,
  holdToColumns,
  type ResolvedAccount,
} from "../hold";
import { assertTransitionAllowed } from "../inventory-workflow";

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
    ).toThrow(/not both/iu);
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
    ).toThrow(/not both/iu);
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

  it("reads a whitespace-only address as no address (#884)", () => {
    // The write gate trims the address to null, so a walk-in built from one
    // would be stored as a hold on nobody. The rules judge it the same way,
    // so a reserved item cannot get that far.
    expect(holdFromInput({ email: "   " }, NO_ACCOUNT)).toEqual({
      kind: "none",
    });
    expect(
      holdFromInput({ email: "\u{A0}", label: "Cart 3" }, NO_ACCOUNT)
    ).toEqual({ kind: "thing", label: "Cart 3", name: null, program: null });
    expect(
      holdFromInput({ email: "\t" }, { accountId: "u-1", accountName: "Sam" })
    ).toEqual({ kind: "account", accountId: "u-1", email: null, name: "Sam" });
  });

  /** The hold, or the refusal's message, so two builds compare whole. */
  function built(input: HoldInput, account: ResolvedAccount): Hold | string {
    try {
      return holdFromInput(input, account);
    } catch (e) {
      return (e as Error).message;
    }
  }

  test.prop([looseHolder, holderText, blankText])(
    "builds the same hold from a blank address as from none (#884)",
    ({ id, label, name, program }, accountName, address) => {
      const account = {
        accountId: id ?? null,
        accountName: id ? (accountName ?? null) : null,
      };
      expect(built({ email: address, label, name, program }, account)).toEqual(
        built({ email: null, label, name, program }, account)
      );
    }
  );

  it("keeps a padded address as typed, for the write gate to fold", () => {
    expect(holdFromInput({ email: " W@In.TEST " }, NO_ACCOUNT)).toEqual({
      kind: "walk_in",
      email: " W@In.TEST ",
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

  it("lowercases the address on a walk-in hold", () => {
    expect(
      holdToColumns({
        kind: "walk_in",
        email: "  Wanda@Example.TEST ",
        name: "Wanda",
        program: "ECE",
      }).currentHolderEmail
    ).toBe("wanda@example.test");
  });

  it("lowercases the address on an account hold", () => {
    expect(
      holdToColumns({
        kind: "account",
        accountId: "u-1",
        email: "Sam@Oregonstate.edu",
        name: "Sam",
      }).currentHolderEmail
    ).toBe("sam@oregonstate.edu");
  });

  it("round-trips a walk-in hold whose address is already normal", () => {
    // The round trip holds only for a normalized address, since #249: the
    // write gate lowercases and the read constructor reports what is stored,
    // so a mixed-case Hold comes back differing in exactly that.
    const hold: Hold = {
      kind: "walk_in",
      email: "w@in.test",
      name: "Wanda",
      program: "ECE",
    };
    expect(holdFromStoredRow(holdToColumns(hold))).toEqual(hold);
    expect(
      holdFromStoredRow(holdToColumns({ ...hold, email: "W@In.TEST" }))
    ).toEqual(hold);
  });
});

describe("holdToColumns, for every hold holdFromInput builds", () => {
  /**
   * The hold as the columns can carry it back: the address folded by the
   * write gate, and an account's name dropped, because the join supplies it.
   */
  function asStored(hold: Hold): Hold {
    switch (hold.kind) {
      case "account":
        return {
          ...hold,
          email: normalizeEmailAddress(hold.email),
          name: null,
        };
      case "walk_in":
        return { ...hold, email: normalizeEmailAddress(hold.email) ?? "" };
      default:
        return hold;
    }
  }

  test.prop([looseHolder, holderText])(
    "stores a person or a thing, never both, and reads back what it stored",
    ({ email, id, label, name, program }, accountName) => {
      let hold: Hold;
      try {
        hold = holdFromInput(
          { email, label, name, program },
          {
            accountId: id ?? null,
            accountName: id ? (accountName ?? null) : null,
          }
        );
      } catch (e) {
        // A person and a label together, which has no hold to store. Any
        // other throw is a bug in the constructor, not a skipped run.
        expect((e as Error).message).toMatch(/on a person or on a thing/u);
        fc.pre(false);
        return;
      }
      const columns = holdToColumns(hold);
      const onAPerson =
        columns.currentHolderId !== null || columns.currentHolderEmail !== null;
      expect(onAPerson && columns.currentHolderLabel !== null).toBe(false);
      expect(holdFromStoredRow(columns)).toEqual(asStored(hold));
    }
  );

  it("builds no walk-in from an address that is only whitespace, so a hold refuses it", () => {
    // The shrunk counterexample from the property above (#845), which used to
    // build a walk-in the write gate then trimmed to a hold on nobody (#884).
    // Now the constructor sees no person, and `assertTransitionAllowed`
    // refuses a reserved or checked-out transition carrying only this.
    const hold = holdFromInput({ email: " ", program: " " }, NO_ACCOUNT);
    expect(hold).toEqual({ kind: "none" });
    expect(() =>
      assertTransitionAllowed(
        { id: "staff-1", role: "admin" },
        {
          holderEmail: " ",
          holderProgram: " ",
          itemId: "item-1",
          nextStatus: "reserved",
        }
      )
    ).toThrow(
      "reserved requires either a holder email or a holder label, not both and not neither"
    );
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
