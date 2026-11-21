CREATE TABLE "setting" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "setting_key_idx" ON "setting" USING btree ("key");--> statement-breakpoint
-- Written by hand (decision 0034): every value of the three single-row tables becomes a setting
-- before they go. Moments are stored as JavaScript writes them (`toISOString`, in UTC).
INSERT INTO "setting" ("key", "value", "updated_at")
SELECT "entry"."key", "entry"."value", "staff_settings"."updated_at"
FROM "staff_settings"
CROSS JOIN LATERAL (VALUES
	('staff.name', to_jsonb("staff_settings"."name")),
	('staff.default_locale', to_jsonb("staff_settings"."default_locale")),
	('staff.offered_locales', to_jsonb("staff_settings"."offered_locales")),
	('staff.default_time_zone', to_jsonb("staff_settings"."default_time_zone")),
	('requests.prefix', to_jsonb("staff_settings"."request_prefix")),
	('setup.completed_at', to_jsonb(to_char("staff_settings"."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
) AS "entry" ("key", "value");--> statement-breakpoint
INSERT INTO "setting" ("key", "value")
SELECT 'requests.last_number', to_jsonb("request_counter"."last_number")
FROM "request_counter";--> statement-breakpoint
INSERT INTO "setting" ("key", "value", "updated_at")
SELECT 'jobs.last_tick', to_jsonb(to_char("job_tick"."last_started_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), "job_tick"."last_started_at"
FROM "job_tick";--> statement-breakpoint
DROP TABLE "job_tick" CASCADE;--> statement-breakpoint
DROP TABLE "request_counter" CASCADE;--> statement-breakpoint
DROP TABLE "staff_settings" CASCADE;
