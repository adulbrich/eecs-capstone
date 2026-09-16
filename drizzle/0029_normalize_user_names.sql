-- Backfill for #433: every user.name is trimmed, and none is blank.
--
-- The write paths narrow from this release on: `requireUserName` in
-- src/lib/_internal/user-name.ts runs in Better Auth's user create hook, and
-- `profileSchema` in src/server/profile.ts trims before its min(1). This
-- catches only rows written before that, which the dev seed has none of.
--
-- A name that is blank once trimmed has nothing to trim to, so it becomes the
-- local part of the address, which is what onid-profile.ts already falls back
-- to when a token carries no name. "Unknown user" is the last resort, the same
-- words comment-thread.tsx shows for a missing author, and only an account
-- with no local part at all can reach it.
UPDATE "user"
SET "name" = CASE
  WHEN trim("name") <> '' THEN trim("name")
  ELSE coalesce(nullif(split_part("email", '@', 1), ''), 'Unknown user')
END
WHERE "name" <> trim("name") OR trim("name") = '';
