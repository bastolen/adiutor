ALTER TABLE "invitation" ADD CONSTRAINT "invitation_locale_valid" CHECK ("invitation"."locale" in ('en-US', 'nl-NL', 'es-ES'));--> statement-breakpoint
ALTER TABLE "job_run" ADD CONSTRAINT "job_run_trigger_valid" CHECK ("job_run"."trigger" in ('tick', 'cli', 'page'));--> statement-breakpoint
ALTER TABLE "job_run" ADD CONSTRAINT "job_run_status_valid" CHECK ("job_run"."status" in ('succeeded', 'failed'));--> statement-breakpoint
ALTER TABLE "job_state" ADD CONSTRAINT "job_state_last_status_valid" CHECK ("job_state"."last_status" in ('succeeded', 'failed'));--> statement-breakpoint
ALTER TABLE "queued_job" ADD CONSTRAINT "queued_job_status_valid" CHECK ("queued_job"."status" in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'discarded'));--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_type_valid" CHECK ("request"."type" in ('hotfix', 'bug', 'support', 'new_feature'));--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_priority_valid" CHECK ("request"."priority" in ('low', 'normal', 'high'));--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_status_valid" CHECK ("request"."status" in ('open', 'todo', 'in_progress', 'waiting', 'done', 'cancelled'));--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_created_by_side_valid" CHECK ("request"."created_by_side" in ('company', 'staff'));--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_description_format_valid" CHECK ("request"."description_format" in ('plain', 'markdown'));--> statement-breakpoint
ALTER TABLE "request_entry" ADD CONSTRAINT "request_entry_kind_valid" CHECK ("request_entry"."kind" in ('comment', 'status', 'title', 'type', 'priority'));--> statement-breakpoint
ALTER TABLE "request_entry" ADD CONSTRAINT "request_entry_author_side_valid" CHECK ("request_entry"."author_side" in ('company', 'staff'));--> statement-breakpoint
ALTER TABLE "request_entry" ADD CONSTRAINT "request_entry_body_format_valid" CHECK ("request_entry"."body_format" in ('plain', 'markdown'));--> statement-breakpoint
ALTER TABLE "app_error" ADD CONSTRAINT "app_error_source_valid" CHECK ("app_error"."source" in ('server', 'browser', 'job'));--> statement-breakpoint
ALTER TABLE "app_error" ADD CONSTRAINT "app_error_route_type_valid" CHECK ("app_error"."route_type" in ('render', 'action', 'route', 'proxy'));--> statement-breakpoint
ALTER TABLE "staff_settings" ADD CONSTRAINT "staff_settings_default_locale_valid" CHECK ("staff_settings"."default_locale" in ('en-US', 'nl-NL', 'es-ES'));