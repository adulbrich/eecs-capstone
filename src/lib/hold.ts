/**
 * Who is holding an inventory item.
 *
 * A hold is on a person or on a thing. Making that a union rather than five
 * loose nullable columns removes one whole class of illegal state: a hold
 * cannot be on a person and a thing at once, because no case has both an
 * address and a label.
 *
 * ## What this does NOT guarantee
 *
 * Read this before deleting any check that looks redundant.
 *
 * - **"Never neither" is not enforced here, and cannot be.** `{ kind: "none" }`
 *   is a legal, necessary case: an available, maintenance or retired item has
 *   no holder. Whether "none" is acceptable depends on the status being moved
 *   to, and this module never sees a status. The per-status invariants in
 *   `inventory-workflow.ts` are what reject a `reserved` or `checked_out`
 *   transition with no holder, and they must stay.
 * - **Not every hold is built through `holdFromInput`.** Read paths construct
 *   cases directly from stored columns. A union constrains only the values
 *   that pass through its constructor.
 *
 * So this module makes illegal states unrepresentable *downstream* of the
 * constructor. It is not a replacement for the wire-level guard in front of it.
 *
 * ## What it does guarantee
 *
 * - **An account beats a typed name.** The `account` case carries no `program`,
 *   and its `name` comes from the account, so a name typed into the assignment
 *   dialog for an address that turns out to have an account has nowhere to be
 *   stored. `holdToColumns` writes `null` to `current_holder_name` for that
 *   case, because storing a second copy of the account's name is what lets the
 *   two drift.
 * - **A walk-in is identified by its address.** The `walk_in` case requires an
 *   `email`, because nothing else identifies that person.
 *
 * ## Whitespace is not trimmed, but an empty string is not a value
 *
 * One exception, added by #249: `holdToColumns` lowercases and trims the
 * address, because the two holder columns are normalized on write. That is
 * the write gate, not the constructor, so a `Hold` in flight still carries
 * the address as typed and only the stored copy is folded.
 *
 * `inventory-workflow.ts` decides person-versus-thing on raw truthiness, and
 * `transitionItemInTx` stores the raw strings. This module matches both on
 * whitespace, so a caller cannot pass a guard on one rule and then be
 * re-judged by a stricter one. Trimming is the input layer's job, and
 * `holderFields` in the lifecycle panel already does it before submitting.
 *
 * An empty string is different, and is deliberately normalized to null. The
 * previous write path stored `""` verbatim, which is not a value any reader
 * wants: `??` does not treat `""` as absent, so an empty `current_holder_name`
 * would stop the admin table's Holder column
 * (`name ?? email ?? label ?? undefined`) from falling through, and render a
 * blank cell for an item that does have a holder. `transitionSchema` accepts
 * `""` for label, name and program (`z.string().max(200)`, no `.min(1)`), so
 * that state was reachable. Normalizing here is a deliberate, tiny departure
 * from byte-identical preservation, and it fixes that rather than causing it.
 *
 * ## The two account lookups
 *
 * `HolderField` asks `lookupUserByEmail` on a debounce to decide whether to
 * show its Name and Program inputs. `resolveHold` asks the same question
 * again inside the transaction. They can disagree, when an account is created
 * between the two calls.
 *
 * That is not a bug and is not reconciled. The client's answer is
 * presentational: it decides which inputs are on screen. The transaction's
 * answer is authoritative: it decides what is written. When they disagree the
 * server wins and drops the typed name, which is exactly the behavior the
 * `account` case makes structural.
 */

import { normalizeEmailAddress } from "./email-address";

/** The five columns on `inventory_items` that describe the current hold. */
export interface HoldColumns {
  currentHolderEmail: string | null;
  currentHolderId: string | null;
  currentHolderLabel: string | null;
  currentHolderName: string | null;
  currentHolderProgram: string | null;
}

/**
 * A hold, in one of its four states. `account` and `walk_in` are both person
 * holds; they are separate cases because only one of them can carry a name and
 * program of its own.
 *
 * `thing` carries a name and program too. The domain reading is that they
 * describe a person and so mean little beside a label, but
 * `transitionItemInTx` stores them on that path today and staff search reads
 * them back (`listAdminInventoryAs` in `inventory-catalog.ts` filters on
 * `current_holder_name` and `current_holder_program`), so dropping them here
 * would lose data and make those rows unfindable. Narrowing this is a behavior
 * change, not a refactor.
 *
 * `account.email` is nullable because a read path must represent whatever is
 * in the database, and because an account id can outlive the account row it
 * names. Every address-driven write path produces a non-null address.
 */
export type Hold =
  | { kind: "none" }
  | {
      kind: "thing";
      label: string;
      name: string | null;
      program: string | null;
    }
  | {
      accountId: string;
      email: string | null;
      kind: "account";
      name: string | null;
    }
  | {
      email: string;
      kind: "walk_in";
      name: string | null;
      program: string | null;
    };

/** The loose fields a caller supplies, before any rule has been applied. */
export interface HoldInput {
  email?: string | null;
  label?: string | null;
  name?: string | null;
  program?: string | null;
}

/** The account an address resolved to, or a pair of nulls when it resolved to none. */
export interface ResolvedAccount {
  accountId: string | null;
  accountName: string | null;
}

/**
 * Turns loose fields into a hold.
 *
 * The person-versus-thing test mirrors `inventory-workflow.ts` exactly: an id and
 * an address both identify the same person, so they count as one, and name and
 * program are attributes rather than a third identity. Keeping the two in step
 * is what stops an input passing the wire guard and then failing here.
 *
 * A caller that already resolved an account id without an address (today only
 * `approveRequestItemAs`, which passes the requester's id) still gets an
 * `account` hold rather than `none`: the id is the identity, and the address
 * may simply not have been loaded.
 */
export function holdFromInput(
  input: HoldInput,
  account: ResolvedAccount
): Hold {
  // `||`, not `??`, on all four: an empty string is not a value. See the
  // empty-string note in the module docblock, whose worked example is
  // precisely an empty `current_holder_name` blanking the admin Holder cell.
  const email = input.email || null;
  const label = input.label || null;
  const name = input.name || null;
  const program = input.program || null;

  if ((email || account.accountId) && label) {
    throw new Error(
      "A hold is on a person or on a thing, not both: supply an address or a label"
    );
  }
  if (account.accountId) {
    return {
      kind: "account",
      accountId: account.accountId,
      email,
      name: account.accountName,
    };
  }
  if (email) {
    return { kind: "walk_in", email, name, program };
  }
  if (label) {
    return { kind: "thing", label, name, program };
  }
  return { kind: "none" };
}

/**
 * Flattens a hold back onto the five columns.
 *
 * The address is lowercased here and only here, which makes this the write
 * gate for the two holder columns: `transitionItemInTx` builds both the item
 * update and the history row from what this returns, so neither can carry an
 * address the other does not (#249). The read constructors above deliberately
 * do not normalize, because an unjoined read must report what is stored.
 */
export function holdToColumns(hold: Hold): HoldColumns {
  switch (hold.kind) {
    case "thing":
      return {
        currentHolderId: null,
        currentHolderEmail: null,
        currentHolderLabel: hold.label,
        currentHolderName: hold.name,
        currentHolderProgram: hold.program,
      };
    case "account":
      // The account's name is deliberately not stored. It is read back through
      // the join, so there is no second copy to fall out of date.
      return {
        currentHolderId: hold.accountId,
        currentHolderEmail: normalizeEmailAddress(hold.email),
        currentHolderLabel: null,
        currentHolderName: null,
        currentHolderProgram: null,
      };
    case "walk_in":
      return {
        currentHolderId: null,
        currentHolderEmail: normalizeEmailAddress(hold.email),
        currentHolderLabel: null,
        currentHolderName: hold.name,
        currentHolderProgram: hold.program,
      };
    default:
      return {
        currentHolderId: null,
        currentHolderEmail: null,
        currentHolderLabel: null,
        currentHolderName: null,
        currentHolderProgram: null,
      };
  }
}

/**
 * The hold as the columns alone describe it, with no account joined. Use this
 * on a path that never loaded the account. It reports the stored name rather
 * than nulling it, matching `storedHolderIdentity`, which is the reader this
 * replaces: an unjoined read should return what is there, not what the write
 * path promises will be there.
 */
export function holdFromStoredRow(row: HoldColumns): Hold {
  if (row.currentHolderId) {
    return {
      kind: "account",
      accountId: row.currentHolderId,
      email: row.currentHolderEmail,
      name: row.currentHolderName,
    };
  }
  if (row.currentHolderEmail) {
    return {
      kind: "walk_in",
      email: row.currentHolderEmail,
      name: row.currentHolderName,
      program: row.currentHolderProgram,
    };
  }
  if (row.currentHolderLabel) {
    return {
      kind: "thing",
      label: row.currentHolderLabel,
      name: row.currentHolderName,
      program: row.currentHolderProgram,
    };
  }
  return { kind: "none" };
}

/**
 * The hold with the joined account reconciled in. The account's address and
 * name win over the stored ones: someone who changed their email or renamed
 * their account is still the same holder. The stored values are authoritative
 * only for a hold that matched no account.
 */
export function holdFromJoinedRow(
  row: HoldColumns,
  joined: { accountEmail: string | null; accountName: string | null }
): Hold {
  if (row.currentHolderId) {
    return {
      kind: "account",
      accountId: row.currentHolderId,
      email: joined.accountEmail ?? row.currentHolderEmail,
      name: joined.accountName ?? row.currentHolderName,
    };
  }
  return holdFromStoredRow(row);
}

/**
 * The holder's address, or null when the hold is on a thing or on nobody.
 * A thing has a label, never an address.
 */
export function holdEmail(hold: Hold): string | null {
  switch (hold.kind) {
    case "account":
      return hold.email;
    case "walk_in":
      return hold.email;
    default:
      return null;
  }
}

/**
 * The holder's name. A thing can carry one, because the columns behind a
 * label hold still accept a name and the write path stores it.
 */
export function holdName(hold: Hold): string | null {
  switch (hold.kind) {
    case "account":
      return hold.name;
    case "walk_in":
      return hold.name;
    case "thing":
      return hold.name;
    default:
      return null;
  }
}

/**
 * The holder in as few characters as possible: name, then address, then label.
 * Used where a column has one line to spend.
 *
 * Returns `null` for an unheld item. A TanStack Table `accessorFn` paired with
 * `sortUndefined: "last"` needs `undefined` instead, because `sortUndefined`
 * does not special-case `null`; such a call site must map it, as the admin
 * inventory table's Holder column does.
 */
export function formatHoldShort(hold: Hold): string | null {
  switch (hold.kind) {
    case "thing":
      // A name beats the label here, unlike in the detailed format. The staff
      // search filter ORs over current_holder_name specifically because this
      // column renders it: staff must be able to read a name off the table
      // and find the row by typing it back in.
      return hold.name ?? hold.label;
    case "account":
      return hold.name ?? hold.email;
    case "walk_in":
      return hold.name ?? hold.email;
    default:
      return null;
  }
}

/**
 * The holder with everything known about them, for a detail panel. A program
 * is only ever appended to a person, never to a label, which matches what the
 * lifecycle panel renders today.
 */
export function formatHoldDetailed(hold: Hold): string | null {
  switch (hold.kind) {
    case "thing":
      return hold.label;
    case "account":
      return hold.name && hold.email
        ? `${hold.name} (${hold.email})`
        : (hold.name ?? hold.email);
    case "walk_in": {
      const suffix = hold.program ? ` · ${hold.program}` : "";
      const base = hold.name ? `${hold.name} (${hold.email})` : hold.email;
      return base + suffix;
    }
    default:
      return null;
  }
}
