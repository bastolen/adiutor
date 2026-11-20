CREATE TABLE "request_assignee" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_entry" DROP CONSTRAINT "request_entry_kind_valid";--> statement-breakpoint
ALTER TABLE "request_entry" ADD COLUMN "subject_user_id" uuid;--> statement-breakpoint
ALTER TABLE "request_assignee" ADD CONSTRAINT "request_assignee_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_assignee" ADD CONSTRAINT "request_assignee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_assignee_request_user_idx" ON "request_assignee" USING btree ("request_id","user_id");--> statement-breakpoint
CREATE INDEX "request_assignee_user_idx" ON "request_assignee" USING btree ("user_id","request_id");--> statement-breakpoint
ALTER TABLE "request_entry" ADD CONSTRAINT "request_entry_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_entry_subject_idx" ON "request_entry" USING btree ("subject_user_id");--> statement-breakpoint
ALTER TABLE "request_entry" ADD CONSTRAINT "request_entry_assignment_fits_values" CHECK (case when "request_entry"."kind" = 'assignee' then "request_entry"."to_value" in ('assigned', 'unassigned') else "request_entry"."subject_user_id" is null end);--> statement-breakpoint
ALTER TABLE "request_entry" ADD CONSTRAINT "request_entry_kind_valid" CHECK ("request_entry"."kind" in ('comment', 'status', 'title', 'type', 'priority', 'assignee'));