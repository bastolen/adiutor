CREATE TABLE "job_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job" text NOT NULL,
	"trigger" text NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_reference" text
);
--> statement-breakpoint
CREATE TABLE "job_state" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_by" uuid,
	"locked_until" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_status" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_alert_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_tick" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"last_started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "job_tick_singleton_true" CHECK ("job_tick"."singleton")
);
--> statement-breakpoint
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
	"finished_at" timestamp with time zone,
	"last_error_reference" text
);
--> statement-breakpoint
ALTER TABLE "job_run" ADD CONSTRAINT "job_run_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_state" ADD CONSTRAINT "job_state_paused_by_user_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_run_job_started_at_idx" ON "job_run" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "job_run_started_at_idx" ON "job_run" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "job_run_started_by_idx" ON "job_run" USING btree ("started_by");--> statement-breakpoint
CREATE UNIQUE INDEX "job_state_name_idx" ON "job_state" USING btree ("name");--> statement-breakpoint
CREATE INDEX "job_state_paused_by_idx" ON "job_state" USING btree ("paused_by");--> statement-breakpoint
CREATE UNIQUE INDEX "job_tick_singleton_idx" ON "job_tick" USING btree ("singleton");--> statement-breakpoint
CREATE INDEX "queued_job_due_idx" ON "queued_job" USING btree ("kind","run_at","id") WHERE "queued_job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "queued_job_batch_key_idx" ON "queued_job" USING btree ("batch_key") WHERE "queued_job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "queued_job_status_kind_idx" ON "queued_job" USING btree ("status","kind");--> statement-breakpoint
CREATE INDEX "queued_job_finished_at_idx" ON "queued_job" USING btree ("finished_at");