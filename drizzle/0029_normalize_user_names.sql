-- Backfill for #433: every user.name is trimmed, and none is blank.
--
-- The write paths narrow from this release on: `requireUserName` in
-- src/lib/_internal/user-name.ts runs in Better Auth's user create and update
-- hooks, and `profileSchema` in src/server/profile.ts trims before its min(1).
-- This catches only rows written before that, which the dev seed has none of.
--
-- regexp_replace rather than trim(), which strips the space character and
-- nothing else: a name of one tab survives `trim()` unchanged and would stay
-- blank on the page. `\s` is what JavaScript's own String.trim covers, which
-- is the rule the write paths apply.
--
-- A name that is blank once trimmed has nothing to trim to, so it becomes the
-- local part of the address, which is what onid-profile.ts already falls back
-- to when a token carries no name. "Unknown user" is the last resort, the same
-- words comment-thread.tsx shows for a missing author, and only an account
-- with no local part at all can reach it.
UPDATE "user"
SET "name" = CASE
  WHEN regexp_replace("name", '^\s+|\s+$', '', 'g') <> ''
    THEN regexp_replace("name", '^\s+|\s+$', '', 'g')
  ELSE coalesce(nullif(split_part("email", '@', 1), ''), 'Unknown user')
END
WHERE "name" <> regexp_replace("name", '^\s+|\s+$', '', 'g')
   OR regexp_replace("name", '^\s+|\s+$', '', 'g') = '';
