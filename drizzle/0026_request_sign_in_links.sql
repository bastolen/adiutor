CREATE TABLE "request_sign_in_link" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "from_request_link" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "request_sign_in_link" ADD CONSTRAINT "request_sign_in_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_sign_in_link" ADD CONSTRAINT "request_sign_in_link_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_sign_in_link_token_hash_idx" ON "request_sign_in_link" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "request_sign_in_link_user_idx" ON "request_sign_in_link" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "request_sign_in_link_request_idx" ON "request_sign_in_link" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_sign_in_link_expires_at_idx" ON "request_sign_in_link" USING btree ("expires_at");