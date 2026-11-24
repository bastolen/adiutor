-- Each column is filled with its default where it's empty before it becomes required, so the
-- migration also works on a database that holds NULLs (the app never wrote one).
UPDATE "account" SET "mfa_verified" = false WHERE "mfa_verified" IS NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "mfa_verified" SET NOT NULL;--> statement-breakpoint
UPDATE "account" SET "confirmed" = true WHERE "confirmed" IS NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "confirmed" SET NOT NULL;--> statement-breakpoint
UPDATE "session" SET "mfa_verified" = false WHERE "mfa_verified" IS NULL;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "mfa_verified" SET NOT NULL;--> statement-breakpoint
UPDATE "session" SET "from_request_link" = false WHERE "from_request_link" IS NULL;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "from_request_link" SET NOT NULL;--> statement-breakpoint
UPDATE "user" SET "allow_staff_sign_in" = true WHERE "allow_staff_sign_in" IS NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "allow_staff_sign_in" SET NOT NULL;--> statement-breakpoint
UPDATE "user" SET "request_emails" = true WHERE "request_emails" IS NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "request_emails" SET NOT NULL;
