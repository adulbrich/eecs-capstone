-- Backfill for #776: a project URL that is one bare domain gains `https://`.
--
-- `projectUrlSchema` in src/lib/project-url.ts requires the scheme from this
-- release on, so an unprefixed value would fail the next time anyone saved
-- its project, on a field they never touched. The legacy import carried 48 of
-- them, such as `www.intel.com`.
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
