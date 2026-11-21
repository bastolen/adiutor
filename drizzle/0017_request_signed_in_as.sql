ALTER TABLE "request" ADD COLUMN "created_signed_in_as" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "created_signed_in_as_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "request_entry" ADD COLUMN "signed_in_as" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "request_entry" ADD COLUMN "signed_in_as_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "request_text_version" ADD COLUMN "signed_in_as" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "request_text_version" ADD COLUMN "signed_in_as_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_created_signed_in_as_staff_id_user_id_fk" FOREIGN KEY ("created_signed_in_as_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_entry" ADD CONSTRAINT "request_entry_signed_in_as_staff_id_user_id_fk" FOREIGN KEY ("signed_in_as_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_text_version" ADD CONSTRAINT "request_text_version_signed_in_as_staff_id_user_id_fk" FOREIGN KEY ("signed_in_as_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_created_signed_in_as_staff_idx" ON "request" USING btree ("created_signed_in_as_staff_id");--> statement-breakpoint
CREATE INDEX "request_entry_signed_in_as_staff_idx" ON "request_entry" USING btree ("signed_in_as_staff_id");--> statement-breakpoint
CREATE INDEX "request_text_version_signed_in_as_staff_idx" ON "request_text_version" USING btree ("signed_in_as_staff_id");--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_created_signed_in_as_fits" CHECK ("request"."created_signed_in_as_staff_id" is null or "request"."created_signed_in_as");--> statement-breakpoint
ALTER TABLE "request_entry" ADD CONSTRAINT "request_entry_signed_in_as_fits" CHECK ("request_entry"."signed_in_as_staff_id" is null or "request_entry"."signed_in_as");--> statement-breakpoint
ALTER TABLE "request_text_version" ADD CONSTRAINT "request_text_version_signed_in_as_fits" CHECK ("request_text_version"."signed_in_as_staff_id" is null or "request_text_version"."signed_in_as");