-- #576: password sign-in is gone, and with it the per-account attempt counter
-- that guarded it (#552). The emailed code is bounded by `verification_sends`
-- instead (ADR-0047).
--
-- A task still running the previous release while this applies finds no table
-- behind its counter. That code fails open by design, so the rollover logs
-- "Sign-in attempt counter failed" and refuses nobody.
DROP TABLE "sign_in_attempts" CASCADE;
--> statement-breakpoint
-- The two kinds only the password path wrote. Nothing prunes them any more,
-- because `reserveVerificationMail` prunes one recipient and one kind at a
-- time, so they would otherwise hold addresses for no purpose indefinitely.
DELETE FROM "verification_sends" WHERE "kind" IN ('verification', 'duplicate');
