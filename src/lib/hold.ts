/**
 * Who is holding an inventory item.
 *
 * A hold is on a person or on a thing, never both and never neither. That rule
 * used to be a runtime check in `validateInvariants` plus five other places
 * that each re-derived some part of it. Here it is the shape of the type: the
 * illegal combinations are unrepresentable, so the check has nothing left to
 * do.
 *
 * Two further rules are structural rather than enforced:
 *
 * - **An account beats a typed name.** The `account` case carries no `program`
 *   and its `name` comes from the account, so a name typed into the assignment
 *   dialog for an address that turns out to have an account has nowhere to be
 *   stored. `holdToColumns` writes `null` to `current_holder_name` for that
 *   case, because storing a copy of the account's name is what lets the two
 *   drift.
 * - **A walk-in is identified by its address.** The `walk_in` case requires an
 *   `email`, because nothing else identifies that person.
 *
 * ## The two account lookups
 *
 * `HolderField` asks `lookupUserByEmail` on a debounce to decide whether to
 * show its Name and Program inputs. `resolveHolder` asks the same question
 * again inside the transaction. They can disagree, when an account is created
 * between the two calls.
 *
 * That is not a bug and is not reconciled. The client's answer is
 * presentational: it decides which inputs are on screen. The transaction's
 * answer is authoritative: it decides what is written. When they disagree the
 * server wins and drops the typed name, which is exactly the behavior the
 * `account` case makes structural.
 */

/** The five columns on `inventory_items` that describe the current hold. */
export interface HoldColumns {
  currentHolderEmail: string | null;
  currentHolderId: string | null;
  currentHolderLabel: string | null;
  currentHolderName: string | null;
  currentHolderProgram: string | null;
}

/**
 * A hold, in one of its three real states. `account` and `walk_in` are both
 * person holds; they are separate cases because only one of them can carry a
 * name and program of its own.
 *
 * `account.email` is nullable only because a read path must be able to
 * represent whatever is in the database. Every write path produces a non-null
 * address for a person hold, which is what makes "a person hold always has an
 * address" true by construction rather than by habit.
 */
export type Hold =
  | { kind: "none" }
  | { kind: "thing"; label: string }
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

function trimmed(value: string | null | undefined): string | null {
  const next = value?.trim();
  return next ? next : null;
}

/**
 * The single place loose fields become a hold, and the single place an illegal
 * combination is rejected. Every write path goes through here, so nothing
 * downstream needs to re-check the invariant.
 */
export function holdFromInput(
  input: HoldInput,
  account: ResolvedAccount
): Hold {
  const email = trimmed(input.email);
  const label = trimmed(input.label);

  if (email && label) {
    throw new Error(
      "A hold is on a person or on a thing, not both: supply an address or a label"
    );
  }
  if (label) {
    // Name and program describe a person, so they are dropped rather than
    // carried alongside a label they do not belong to.
    return { kind: "thing", label };
  }
  if (!email) {
    return { kind: "none" };
  }
  if (account.accountId) {
    return {
      kind: "account",
      accountId: account.accountId,
      email,
      name: account.accountName,
    };
  }
  return {
    kind: "walk_in",
    email,
    name: trimmed(input.name),
    program: trimmed(input.program),
  };
}

/** Flattens a hold back onto the five columns. */
export function holdToColumns(hold: Hold): HoldColumns {
  switch (hold.kind) {
    case "thing":
      return {
        currentHolderId: null,
        currentHolderEmail: null,
        currentHolderLabel: hold.label,
        currentHolderName: null,
        currentHolderProgram: null,
      };
    case "account":
      // The account's name is deliberately not stored. It is read back through
      // the join, so there is no second copy to fall out of date.
      return {
        currentHolderId: hold.accountId,
        currentHolderEmail: hold.email,
        currentHolderLabel: null,
        currentHolderName: null,
        currentHolderProgram: null,
      };
    case "walk_in":
      return {
        currentHolderId: null,
        currentHolderEmail: hold.email,
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
 * on a path that never loaded the account: it reports an account hold without
 * a name rather than guessing one.
 */
export function holdFromStoredRow(row: HoldColumns): Hold {
  if (row.currentHolderId) {
    return {
      kind: "account",
      accountId: row.currentHolderId,
      email: row.currentHolderEmail,
      name: null,
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
    return { kind: "thing", label: row.currentHolderLabel };
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
 * The holder in as few characters as possible: name, then address, then label.
 * Used where a column has one line to spend, such as the admin table.
 */
export function formatHoldShort(hold: Hold): string | null {
  switch (hold.kind) {
    case "thing":
      return hold.label;
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
 * belongs to a walk-in address, never to a label, so it is only ever appended
 * on that branch.
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
