-- #646: the bid and assignment tables from the original scaffold. #33 closed
-- unbuilt, and placement (#644) keeps bids in the staff member's browser
-- (ADR-0056), so nothing will ever read or write them.
--
-- No code has written either table, so both should be empty. If one is not,
-- someone put rows there by hand, and this refuses rather than dropping them:
-- the deploy fails and the rows stay for a person to look at.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "project_bids") OR EXISTS (SELECT 1 FROM "project_assignments") THEN
    RAISE EXCEPTION 'project_bids or project_assignments holds rows; export or delete them before dropping the tables (#646)';
  END IF;
END
$$;
--> statement-breakpoint
DROP TABLE "project_assignments" CASCADE;
--> statement-breakpoint
DROP TABLE "project_bids" CASCADE;
