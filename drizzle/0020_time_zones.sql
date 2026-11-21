ALTER TABLE "user" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "staff_settings" ADD COLUMN "default_time_zone" text DEFAULT 'UTC' NOT NULL;