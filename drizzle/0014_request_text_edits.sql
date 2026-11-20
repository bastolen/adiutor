CREATE TABLE "request_text_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"entry_id" uuid,
	"body" text NOT NULL,
	"body_format" text NOT NULL,
	"edited_by" uuid,
	"edited_by_side" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_text_version_body_format_valid" CHECK ("request_text_version"."body_format" in ('plain', 'markdown')),
	CONSTRAINT "request_text_version_edited_by_side_valid" CHECK ("request_text_version"."edited_by_side" in ('company', 'staff'))
);
--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "description_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "request_entry" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "request_text_version" ADD CONSTRAINT "request_text_version_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_text_version" ADD CONSTRAINT "request_text_version_entry_id_request_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."request_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_text_version" ADD CONSTRAINT "request_text_version_edited_by_user_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_text_version_request_idx" ON "request_text_version" USING btree ("request_id","id");--> statement-breakpoint
CREATE INDEX "request_text_version_entry_idx" ON "request_text_version" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "request_text_version_edited_by_idx" ON "request_text_version" USING btree ("edited_by");