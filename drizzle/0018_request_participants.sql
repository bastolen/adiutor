ALTER TABLE "request_assignee" RENAME TO "request_participant";--> statement-breakpoint
ALTER TABLE "request_participant" DROP CONSTRAINT "request_assignee_request_id_request_id_fk";
--> statement-breakpoint
ALTER TABLE "request_participant" DROP CONSTRAINT "request_assignee_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "request_assignee_request_user_idx";--> statement-breakpoint
DROP INDEX "request_assignee_user_idx";--> statement-breakpoint
-- Everyone on a request so far is assigned to it: the role is filled in before it becomes required.
ALTER TABLE "request_participant" ADD COLUMN "role" text;--> statement-breakpoint
UPDATE "request_participant" SET "role" = 'assignee';--> statement-breakpoint
ALTER TABLE "request_participant" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "request_participant" ADD CONSTRAINT "request_participant_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_participant" ADD CONSTRAINT "request_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_participant_request_user_role_idx" ON "request_participant" USING btree ("request_id","user_id","role");--> statement-breakpoint
CREATE INDEX "request_participant_user_idx" ON "request_participant" USING btree ("user_id","role","request_id");--> statement-breakpoint
ALTER TABLE "request_participant" ADD CONSTRAINT "request_participant_role_valid" CHECK ("request_participant"."role" in ('assignee', 'subscriber'));--> statement-breakpoint
-- The requests there are get their subscribers from what they hold: whoever raised one, replied
-- to it or is mentioned in it, as far as they can still read it (an active account on the staff
-- or in the request's company).
INSERT INTO "request_participant" ("request_id", "user_id", "role")
SELECT DISTINCT "involved"."request_id", "involved"."user_id", 'subscriber'
FROM (
	SELECT "id" AS "request_id", "created_by" AS "user_id" FROM "request"
	UNION
	SELECT "request_id", "author_id" FROM "request_entry" WHERE "kind" = 'comment'
	UNION
	-- Mentions in the description and in replies; a mention in an internal note subscribes nobody here.
	SELECT "request_mention"."request_id", "request_mention"."user_id" FROM "request_mention"
	LEFT JOIN "request_entry" ON "request_entry"."id" = "request_mention"."entry_id"
	WHERE "request_mention"."entry_id" IS NULL OR "request_entry"."kind" = 'comment'
) "involved"
JOIN "request" ON "request"."id" = "involved"."request_id"
JOIN "user" ON "user"."id" = "involved"."user_id"
WHERE "user"."deactivated_at" IS NULL
	AND (
		"user"."platform_role" IS NOT NULL
		OR EXISTS (
			SELECT 1 FROM "membership"
			WHERE "membership"."user_id" = "user"."id" AND "membership"."company_id" = "request"."company_id"
		)
	)
ON CONFLICT DO NOTHING;
