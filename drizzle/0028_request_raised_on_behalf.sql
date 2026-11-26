ALTER TABLE "request" ADD COLUMN "created_on_behalf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "created_on_behalf_by" uuid;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_created_on_behalf_by_user_id_fk" FOREIGN KEY ("created_on_behalf_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_created_on_behalf_by_idx" ON "request" USING btree ("created_on_behalf_by");--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_created_on_behalf_fits" CHECK (("request"."created_on_behalf_by" is null or "request"."created_on_behalf") and (not "request"."created_on_behalf" or "request"."created_by_side" = 'company'));