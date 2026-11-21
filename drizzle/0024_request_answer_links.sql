CREATE TABLE "request_answer_link" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"proposal_entry_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_answer_link_answer_valid" CHECK ("request_answer_link"."answer" in ('approve', 'deny')),
	CONSTRAINT "request_answer_link_used_fits" CHECK (("request_answer_link"."used_at" is null) = ("request_answer_link"."answer" is null))
);
--> statement-breakpoint
ALTER TABLE "request_answer_link" ADD CONSTRAINT "request_answer_link_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_answer_link" ADD CONSTRAINT "request_answer_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_answer_link" ADD CONSTRAINT "request_answer_link_proposal_entry_id_request_entry_id_fk" FOREIGN KEY ("proposal_entry_id") REFERENCES "public"."request_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_answer_link_token_idx" ON "request_answer_link" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "request_answer_link_request_idx" ON "request_answer_link" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_answer_link_user_idx" ON "request_answer_link" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "request_answer_link_proposal_idx" ON "request_answer_link" USING btree ("proposal_entry_id");