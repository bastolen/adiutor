CREATE TABLE "request_attachment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid,
	"entry_id" uuid,
	"uploaded_by" uuid,
	"signed_in_as" boolean DEFAULT false NOT NULL,
	"signed_in_as_staff_id" uuid,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removed_signed_in_as" boolean DEFAULT false NOT NULL,
	"removed_signed_in_as_staff_id" uuid,
	"file_deleted_at" timestamp with time zone,
	CONSTRAINT "request_attachment_content_type_valid" CHECK ("request_attachment"."content_type" in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation', 'application/zip', 'application/x-7z-compressed', 'application/gzip', 'video/mp4', 'video/quicktime', 'video/webm')),
	CONSTRAINT "request_attachment_size_fits" CHECK ("request_attachment"."size" > 0),
	CONSTRAINT "request_attachment_entry_fits" CHECK ("request_attachment"."entry_id" is null or "request_attachment"."request_id" is not null),
	CONSTRAINT "request_attachment_sent_fits" CHECK (("request_attachment"."request_id" is null or "request_attachment"."uploaded_at" is not null) and ("request_attachment"."removed_at" is null or "request_attachment"."request_id" is not null)),
	CONSTRAINT "request_attachment_signed_in_as_fits" CHECK ("request_attachment"."signed_in_as_staff_id" is null or "request_attachment"."signed_in_as"),
	CONSTRAINT "request_attachment_removed_fits" CHECK ("request_attachment"."removed_at" is not null or ("request_attachment"."removed_by" is null and not "request_attachment"."removed_signed_in_as" and "request_attachment"."file_deleted_at" is null)),
	CONSTRAINT "request_attachment_removed_signed_in_as_fits" CHECK ("request_attachment"."removed_signed_in_as_staff_id" is null or "request_attachment"."removed_signed_in_as")
);
--> statement-breakpoint
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_entry_id_request_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."request_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_signed_in_as_staff_id_user_id_fk" FOREIGN KEY ("signed_in_as_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_removed_by_user_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_removed_signed_in_as_staff_id_user_id_fk" FOREIGN KEY ("removed_signed_in_as_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_attachment_request_idx" ON "request_attachment" USING btree ("request_id","entry_id");--> statement-breakpoint
CREATE INDEX "request_attachment_entry_idx" ON "request_attachment" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "request_attachment_uploaded_by_idx" ON "request_attachment" USING btree ("uploaded_by","created_at");--> statement-breakpoint
CREATE INDEX "request_attachment_signed_in_as_staff_idx" ON "request_attachment" USING btree ("signed_in_as_staff_id");--> statement-breakpoint
CREATE INDEX "request_attachment_removed_by_idx" ON "request_attachment" USING btree ("removed_by");--> statement-breakpoint
CREATE INDEX "request_attachment_removed_signed_in_as_staff_idx" ON "request_attachment" USING btree ("removed_signed_in_as_staff_id");--> statement-breakpoint
CREATE INDEX "request_attachment_unsent_idx" ON "request_attachment" USING btree ("created_at") WHERE "request_attachment"."request_id" is null;