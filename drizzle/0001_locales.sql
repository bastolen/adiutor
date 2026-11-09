ALTER TABLE "user" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "locale" text DEFAULT 'en-US' NOT NULL;