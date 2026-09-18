import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "#/db";
import { projectCategories, projects, userInterests } from "#/db/schema";
import { readSession } from "#/lib/_internal/auth-guards";
import type { SearchProjectsInput } from "../search";
import { toSqlVector } from "./project-embeddings";
import { projectSummarySelect, runsInProgram } from "./project-summary";

/**
 * Request entry point: resolves the viewer, then delegates. Tests call
 * `searchProjectsImpl` directly with an explicit viewer id instead.
 */
export async function searchProjectsForRequest(data: SearchProjectsInput) {
  const session = await readSession();
  return searchProjectsImpl(data, session?.user?.id ?? null);
}

/**
 * A user's query as a literal `LIKE` operand: `%` and `_` stop being
 * wildcards, and a backslash stops being the escape character.
 *
 * Unescaped, a bare `%` matches every row with a non-null value in any of the
 * three columns, and a query like `100%` quietly means something other than
 * what was typed. This listing is anonymous, which is why it is escaped here.
 *
 * `\` is escaped as well as the two the issue names, because Postgres reads
 * it as `LIKE`'s own escape by default: a query ending in one would otherwise
 * neutralize the closing `%` this is wrapped in and silently become a suffix
 * match. One character class in one pass, rather than three sequential
 * `replace` calls: a sequential version has to do the backslash first or it
 * escapes the escapes the later passes add, and this has no order to get
 * wrong. Do not "simplify" it into the sequential form.
 *
 * `buildAdminProjectListConditions` in `projects-queries.ts` builds its
 * pattern raw and has the same gap. It is staff-only, so it is left alone
 * rather than fixed in passing (#476).
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** The viewer's interest vector, or null for a visitor or a member without one. One indexed row. */
async function interestsVectorFor(
  viewerId: string | null
): Promise<number[] | null> {
  if (!viewerId) {
    return null;
  }
  const [row] = await db
    .select({ embedding: userInterests.embedding })
    .from(userInterests)
    .where(eq(userInterests.userId, viewerId));
  return row?.embedding ?? null;
}

export async function searchProjectsImpl(
  data: SearchProjectsInput,
  viewerId: string | null = null
) {
  const trimmed = data.query.trim();
  const conditions = [
    eq(projects.status, data.archivedOnly ? "archived" : "published"),
    isNull(projects.deletedAt),
  ];
  if (trimmed) {
    // The tsvector answers stemming, field weighting and the quoted-phrase
    // and -exclude syntax SearchHint advertises; the ILIKEs answer what it
    // structurally cannot see, which is partial words and identifier-shaped
    // data. Postgres classifies an address as one `email` token and emits it
    // whole, so `alice.smith@oregonstate.edu` in the vector matches neither
    // `alice` nor `oregonstate.edu`, and putting contacts in the generated
    // column would have bought exact-full-address search and nothing else
    // (#476). Title is here too: the admin listing has always or'd an ILIKE
    // beside its tsvector, and without one here a partial contact name would
    // match while a partial title did not.
    //
    // The same array feeds the count query below, so the total cannot
    // disagree with the rows.
    const like = `%${escapeLikePattern(trimmed)}%`;
    const match = or(
      sql`${projects.searchVector} @@ websearch_to_tsquery('english', ${trimmed})`,
      ilike(projects.title, like),
      ilike(projects.contactName, like),
      ilike(projects.contactEmail, like)
    );
    if (match) {
      conditions.push(match);
    }
  }
  // Any-match: a project shared between two programs answers to both, and
  // the filter itself stays single-valued (#462).
  if (data.programId) {
    conditions.push(runsInProgram(data.programId));
  }
  if (data.acceptingOnly) {
    conditions.push(eq(projects.acceptingApplicants, true));
  }
  if (data.studentProposedOnly) {
    conditions.push(eq(projects.studentProposed, true));
  }
  if (data.requiresNdaOnly) {
    conditions.push(eq(projects.requiresNdaIp, true));
  }
  if (data.categoryIds.length > 0) {
    const matchingProjectIds = db
      .select({ projectId: projectCategories.projectId })
      .from(projectCategories)
      .where(inArray(projectCategories.categoryId, data.categoryIds))
      .groupBy(projectCategories.projectId)
      .having(sql`count(*) = ${data.categoryIds.length}`);
    conditions.push(inArray(projects.id, matchingProjectIds));
  }

  /**
   * The date the listing sorts on. `publishedAt` alone is wrong for the
   * archive: `archivedOnly` above resolves to `status = 'archived'` for a null
   * viewer, so the archive is public, and the 302 projects imported from the
   * legacy portal with no publish date (its event log only starts 2022-08-03)
   * carry a null there. Postgres `DESC` is NULLS FIRST, so ordering on the
   * bare column floats every dateless row above everything with a real date.
   *
   * `createdAt` rather than `updatedAt` as the fallback, for two reasons.
   * `updatedAt` moves on every edit, so one staff typo fix would jump a 2019
   * project to the top of "newest"; and measured against the 245 imported
   * rows that do have a publish date, `createdAt` is the closer estimate
   * (mean error 15.8 days against 37.0).
   *
   * A no-op for anything proposed in this app, where `publishedAt` is set on
   * every publish. `projects_published_at_idx` does not serve this ordering;
   * at the row counts here that costs nothing, and an expression index is the
   * fix if it ever does.
   */
  const listingDate = sql`coalesce(${projects.publishedAt}, ${projects.createdAt})`;

  // Only ever reached with a query, because `relevance` without one resolves
  // to `newest` below: with an empty box `ts_rank` is 0 for every row and
  // this compiled to exactly what `newest` compiles to, so the select said
  // "Most relevant" over date-ordered rows, relevant to nothing (#475). The
  // argument recorded here before, that defaulting to `newest` would silently
  // reorder every existing keyword search, only ever covered URLs carrying a
  // query, and those still resolve to `relevance`.
  const relevanceOrder = sql`ts_rank(${projects.searchVector}, websearch_to_tsquery('english', ${trimmed})) DESC, ${listingDate} DESC`;

  // Read for every signed-in viewer, not only under `recommended`: the
  // listing tells the reader whether the recommended sort is open to them,
  // and reading that here, in the loader, is what stops the prompt flashing
  // on first paint for someone who already has interests (#321).
  const interestsVector = await interestsVectorFor(viewerId);

  /**
   * The ordering this call actually uses, resolved once and used for both the
   * SQL below and the `order` the caller reads back.
   *
   * An absent `sort` means the reader has expressed no preference, which the
   * URL can now say because the param no longer carries a default. For a
   * viewer with an interest vector that resolves to `recommended`: they wrote
   * interests and this is what those interests are for, and making them pick
   * the sort on every visit was the whole of #424.
   *
   * The gate is the vector, never the text. A member whose interests saved but
   * failed to embed resolves to `relevance`, so the default never promises an
   * order it cannot deliver. For the same reason a hand-typed
   * `?order=recommended` from such a viewer reports `relevance`: the page still
   * renders, ordered by relevance, and says which ordering it used.
   */
  // Where a viewer with no interest vector lands, which is the whole of the
  // resolution table in #475 once `recommended` is off the table: a typed
  // query means `relevance`, an empty box means `newest`. Named once because
  // both the absent-sort default and the `recommended` fallback need it.
  const defaultWithoutVector = trimmed ? "relevance" : "newest";
  const canRecommend = interestsVector !== null;
  const requested =
    data.sort ?? (canRecommend ? "recommended" : defaultWithoutVector);
  // Two orderings cannot always be delivered, and both degrade here rather
  // than at the call site, so the select and the rows can never disagree:
  // `recommended` needs a vector, `relevance` needs a query. A URL carrying
  // `?order=relevance` with an empty box therefore renders in date order and
  // reports `newest`, which is what the reader sees in the select (#475).
  let order = requested;
  if (order === "recommended" && !canRecommend) {
    order = defaultWithoutVector;
  }
  if (order === "relevance" && !trimmed) {
    order = "newest";
  }

  let orderBy = relevanceOrder;
  if (order === "newest") {
    orderBy = sql`${listingDate} DESC`;
  } else if (order === "oldest") {
    orderBy = sql`${listingDate} ASC`;
  } else if (order === "title") {
    // Case-insensitive, or "Zebra" would sort above "apple" under the C
    // collation. `title` is NOT NULL, so there is no null case to place.
    orderBy = sql`lower(${projects.title}) ASC`;
  } else if (order === "updated") {
    // The objection recorded above against `updatedAt` as the listing date,
    // that one staff typo fix jumps a 2019 project to the top, is an
    // objection to it being implicit. A reader who picks "Recently updated"
    // by name has asked for exactly that (#475).
    orderBy = sql`${projects.updatedAt} DESC`;
  } else if (order === "recommended" && interestsVector) {
    const probe = toSqlVector(interestsVector);
    // Null embeddings sort last rather than being filtered out: a project
    // that failed to embed must stay reachable.
    //
    // The date, so that the projects sharing the null case are ordered by
    // something a reader would recognise before the id breaks the rest of the
    // tie. #427 gave every published and archived project a vector, so that
    // group should be empty now; it refills one row at a time whenever an
    // embedding call fails.
    orderBy = sql`${projects.embedding} IS NULL, ${projects.embedding} <=> ${probe}::vector, ${listingDate} DESC`;
  }

  const offset = (data.page - 1) * data.pageSize;
  const rows = await db
    .select(projectSummarySelect)
    .from(projects)
    .where(and(...conditions))
    // `projects.id` last, always, and passed here rather than appended to each
    // branch above so that a fourth ordering cannot forget it. Why an ordering
    // has to be total: "Paging a listing needs a total ordering" in
    // docs/QUIRKS.md (#429).
    .orderBy(orderBy, projects.id)
    .limit(data.pageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(...conditions));

  return {
    rows,
    total: count,
    page: data.page,
    pageSize: data.pageSize,
    /**
     * The ordering this result is in, which is not always the one the URL
     * asked for: absent resolves by the viewer's vector, and `recommended`
     * without one resolves to `relevance`. The route reads this rather than
     * re-deriving it, so the Sort select and the prompt line under the search
     * row cannot disagree with the rows beneath them.
     */
    order,
    /**
     * Whether the recommended sort is open to this viewer, and if not, why:
     * the filter bar shows a sign-in prompt to a visitor and an add-your-
     * interests prompt to a member with no vector. Never the vector itself.
     */
    viewer: {
      signedIn: viewerId !== null,
      canRecommend: interestsVector !== null,
    },
  };
}
