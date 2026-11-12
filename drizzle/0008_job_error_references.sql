ALTER TABLE "job_run" ADD COLUMN "error_reference" text;--> statement-breakpoint
ALTER TABLE "queued_job" ADD COLUMN "last_error_reference" text;