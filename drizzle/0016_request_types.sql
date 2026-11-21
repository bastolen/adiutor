CREATE TABLE "request_type" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"starting_priority" text NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "request_type_key_form" CHECK ("request_type"."key" ~ '^[a-z0-9_]{1,40}$'),
	CONSTRAINT "request_type_starting_priority_valid" CHECK ("request_type"."starting_priority" in ('low', 'normal', 'high'))
);
--> statement-breakpoint
ALTER TABLE "request" DROP CONSTRAINT "request_type_valid";--> statement-breakpoint
CREATE UNIQUE INDEX "request_type_key_idx" ON "request_type" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "request_type_position_idx" ON "request_type" USING btree ("position");--> statement-breakpoint
-- The four types that were built in become the first rows, with the keys requests hold, named in
-- Adiutor's default language (English before setup, which names them in its own).
INSERT INTO "request_type" ("key", "name", "description", "starting_priority", "position")
SELECT t.key,
	CASE s.locale WHEN 'nl-NL' THEN t.name_nl WHEN 'es-ES' THEN t.name_es ELSE t.name_en END,
	CASE s.locale WHEN 'nl-NL' THEN t.description_nl WHEN 'es-ES' THEN t.description_es ELSE t.description_en END,
	t.starting_priority, t.position
FROM (VALUES
	('hotfix', 'Hotfix', 'Hotfix', 'Corrección urgente', 'Something is broken and needs fixing right away.', 'Er is iets kapot dat meteen moet worden opgelost.', 'Algo está roto y hay que arreglarlo ya.', 'high', 1),
	('bug', 'Bug', 'Bug', 'Error', 'Something doesn’t work as it should.', 'Iets werkt niet zoals het hoort.', 'Algo no funciona como debería.', 'normal', 2),
	('support', 'Support', 'Support', 'Soporte', 'A question, or help with something.', 'Een vraag, of hulp bij iets.', 'Una pregunta o ayuda con algo.', 'normal', 3),
	('new_feature', 'New feature', 'Nieuwe functie', 'Nueva función', 'Something new, or a change to how things work.', 'Iets nieuws, of een wijziging in hoe iets werkt.', 'Algo nuevo o un cambio en cómo funciona algo.', 'low', 4)
) AS t(key, name_en, name_nl, name_es, description_en, description_nl, description_es, starting_priority, position)
LEFT JOIN (SELECT "default_locale" AS locale FROM "staff_settings" LIMIT 1) AS s ON true;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_type_request_type_key_fk" FOREIGN KEY ("type") REFERENCES "public"."request_type"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_type_idx" ON "request" USING btree ("type");