-- Backfill for #776: a project URL that is one bare domain gains `https://`.
--
-- `projectUrlSchema` in src/lib/project-url.ts requires the scheme, as `.url()`
-- did before it, so an unprefixed value blocks every save of its project on a
-- field nobody touched. 40 of the 242 archived legacy URLs were one, such as
-- `www.intel.com`; this WHERE, run as a SELECT over that export, matched
-- exactly those 40, and each result passes the schema.
--
-- Only a value shaped like a host, with an optional path, is rewritten. Prose,
-- several links, `none` and any value already holding a scheme stay as they
-- are: the project page shows those as plain text, and they are fixed by hand.
-- The trim is `\s`, as in 0029, because a trailing newline came in from the
-- legacy portal too.
UPDATE "projects"
SET "url" = 'https://' || regexp_replace("url", '^\s+|\s+$', '', 'g')
WHERE regexp_replace("url", '^\s+|\s+$', '', 'g')
  ~ '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}([/?#][^[:space:]]*)?$';
