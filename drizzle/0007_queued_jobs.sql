CREATE TABLE "queued_job" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"batch_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "queued_job_due_idx" ON "queued_job" USING btree ("run_at","id") WHERE "queued_job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "queued_job_batch_key_idx" ON "queued_job" USING btree ("batch_key") WHERE "queued_job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "queued_job_kind_status_idx" ON "queued_job" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "queued_job_finished_at_idx" ON "queued_job" USING btree ("finished_at");