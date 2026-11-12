CREATE TABLE "impersonation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"session_id" uuid,
	"staff_user_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text,
	"return_to" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "impersonation" ADD CONSTRAINT "impersonation_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation" ADD CONSTRAINT "impersonation_staff_user_id_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation" ADD CONSTRAINT "impersonation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "impersonation_session_idx" ON "impersonation" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "impersonation_staff_user_idx" ON "impersonation" USING btree ("staff_user_id");--> statement-breakpoint
CREATE INDEX "impersonation_user_idx" ON "impersonation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "impersonation_expires_at_idx" ON "impersonation" USING btree ("expires_at");