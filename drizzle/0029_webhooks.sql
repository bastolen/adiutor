CREATE TABLE "webhook" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"url_sealed" text NOT NULL,
	"url_host" text NOT NULL,
	"format" text NOT NULL,
	"events" text[] NOT NULL,
	"all_types" boolean DEFAULT true NOT NULL,
	"secret_sealed" text NOT NULL,
	"secret_renewed_at" timestamp with time zone,
	"turned_off_at" timestamp with time zone,
	"turned_off_reason" text,
	"turned_off_by" uuid,
	"failing_since" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "webhook_format_valid" CHECK ("webhook"."format" in ('json', 'chat')),
	CONSTRAINT "webhook_turned_off_reason_valid" CHECK ("webhook"."turned_off_reason" in ('manual', 'failing', 'gone', 'unreadable')),
	CONSTRAINT "webhook_events_valid" CHECK ("webhook"."events" <@ array['raised', 'reply', 'note', 'status', 'assignee', 'details']::text[] and cardinality("webhook"."events") > 0),
	CONSTRAINT "webhook_turned_off_has_reason" CHECK (("webhook"."turned_off_at" is null) = ("webhook"."turned_off_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"request_id" uuid,
	"test" boolean DEFAULT false NOT NULL,
	"news" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_status" integer,
	"last_error" text,
	"last_duration_ms" integer,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_delivery_status_valid" CHECK ("webhook_delivery"."status" in ('pending', 'delivered', 'failed', 'cancelled')),
	CONSTRAINT "webhook_delivery_last_error_valid" CHECK ("webhook_delivery"."last_error" in ('timeout', 'dns', 'refused_address', 'connection', 'tls', 'redirect', 'http', 'unreadable')),
	CONSTRAINT "webhook_delivery_test_has_no_request" CHECK ("webhook_delivery"."test" = ("webhook_delivery"."request_id" is null))
);
--> statement-breakpoint
CREATE TABLE "webhook_request_type" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"request_type_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_turned_off_by_user_id_fk" FOREIGN KEY ("turned_off_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_request_type" ADD CONSTRAINT "webhook_request_type_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_request_type" ADD CONSTRAINT "webhook_request_type_request_type_key_request_type_key_fk" FOREIGN KEY ("request_type_key") REFERENCES "public"."request_type"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_turned_off_by_idx" ON "webhook" USING btree ("turned_off_by");--> statement-breakpoint
CREATE INDEX "webhook_created_by_idx" ON "webhook" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "webhook_delivery_webhook_idx" ON "webhook_delivery" USING btree ("webhook_id","id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_request_idx" ON "webhook_delivery" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_created_at_idx" ON "webhook_delivery" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_request_type_webhook_type_idx" ON "webhook_request_type" USING btree ("webhook_id","request_type_key");--> statement-breakpoint
CREATE INDEX "webhook_request_type_type_idx" ON "webhook_request_type" USING btree ("request_type_key");