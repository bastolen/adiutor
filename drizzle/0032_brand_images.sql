CREATE TABLE "brand_image" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"content" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_image_kind_valid" CHECK ("brand_image"."kind" in ('logo', 'icon'))
);
--> statement-breakpoint
ALTER TABLE "brand_image" ADD CONSTRAINT "brand_image_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_image_kind_idx" ON "brand_image" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "brand_image_uploaded_by_idx" ON "brand_image" USING btree ("uploaded_by");