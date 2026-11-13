CREATE TABLE "request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" integer NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"description_format" text DEFAULT 'plain' NOT NULL,
	"type" text NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reopened_at" timestamp with time zone,
	"created_by" uuid,
	"created_by_side" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_counter" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"last_number" integer NOT NULL,
	CONSTRAINT "request_counter_singleton_true" CHECK ("request_counter"."singleton")
);
--> statement-breakpoint
CREATE TABLE "request_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"author_id" uuid,
	"author_side" text NOT NULL,
	"body" text,
	"body_format" text DEFAULT 'plain' NOT NULL,
	"from_value" text,
	"to_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_entry_kind_fits_values" CHECK (("request_entry"."kind" = 'comment') = ("request_entry"."body" is not null) and ("request_entry"."kind" = 'comment') = ("request_entry"."to_value" is null))
);
--> statement-breakpoint
ALTER TABLE "staff_settings" ADD COLUMN "request_prefix" text DEFAULT 'AD' NOT NULL;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_entry" ADD CONSTRAINT "request_entry_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_entry" ADD CONSTRAINT "request_entry_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_number_idx" ON "request" USING btree ("number");--> statement-breakpoint
CREATE INDEX "request_company_activity_idx" ON "request" USING btree ("company_id","last_activity_at","id");--> statement-breakpoint
CREATE INDEX "request_activity_idx" ON "request" USING btree ("last_activity_at","id");--> statement-breakpoint
CREATE INDEX "request_created_by_idx" ON "request" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "request_counter_singleton_idx" ON "request_counter" USING btree ("singleton");--> statement-breakpoint
CREATE INDEX "request_entry_request_idx" ON "request_entry" USING btree ("request_id","id");--> statement-breakpoint
CREATE INDEX "request_entry_author_idx" ON "request_entry" USING btree ("author_id");