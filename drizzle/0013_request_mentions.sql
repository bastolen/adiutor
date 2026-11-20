CREATE TABLE "request_mention" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"entry_id" uuid,
	"user_id" uuid,
	"side" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_mention_side_valid" CHECK ("request_mention"."side" in ('company', 'staff'))
);
--> statement-breakpoint
ALTER TABLE "request_mention" ADD CONSTRAINT "request_mention_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_mention" ADD CONSTRAINT "request_mention_entry_id_request_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."request_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_mention" ADD CONSTRAINT "request_mention_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_mention_request_idx" ON "request_mention" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_mention_entry_idx" ON "request_mention" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "request_mention_user_idx" ON "request_mention" USING btree ("user_id");