DROP INDEX "queued_job_kind_status_idx";--> statement-breakpoint
DROP INDEX "queued_job_due_idx";--> statement-breakpoint
CREATE INDEX "queued_job_status_kind_idx" ON "queued_job" USING btree ("status","kind");--> statement-breakpoint
CREATE INDEX "queued_job_due_idx" ON "queued_job" USING btree ("kind","run_at","id") WHERE "queued_job"."status" = 'queued';