-- Alıştırmada madde kontrolü (OG-085, IST-056; DOM-BEC-047). Numara görev satırındadır.
-- Tablo yenidir; kısıtlar `not valid` adımı olmadan tek adımda eklenir. Deneme
-- `(institution_id, attempt_id)` bileşik yabancı anahtarıyla bağlanır; birincil anahtar
-- `(institution_id, attempt_id, question_version_id, check_number)` eşzamanlı iki kontrolden birini
-- reddeder ve deneme yabancı anahtarının indeksidir; `check_number` core hakkını (2) aşamaz.
-- Elle eklenen: dosyanın sonundaki değişmez satır tetikleyicileri (Drizzle tetikleyici üretmez;
-- işlev `kampus_reject_immutable_change` migration 0013'tedir).
--> statement-breakpoint
CREATE TABLE "attempt_item_checks" (
	"institution_id" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_version_id" text NOT NULL,
	"check_number" integer NOT NULL,
	"response" jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "attempt_item_checks_pkey" PRIMARY KEY("institution_id","attempt_id","question_version_id","check_number"),
	CONSTRAINT "attempt_item_checks_number_check" CHECK ("attempt_item_checks"."check_number" between 1 and 2),
	CONSTRAINT "attempt_item_checks_response_check" CHECK (jsonb_typeof("attempt_item_checks"."response") = 'object'),
	CONSTRAINT "attempt_item_checks_version_check" CHECK ("attempt_item_checks"."version" = 1 and "attempt_item_checks"."archived_at" is null)
);
--> statement-breakpoint
ALTER TABLE "attempt_item_checks" ADD CONSTRAINT "attempt_item_checks_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_item_checks" ADD CONSTRAINT "attempt_item_checks_attempt_fkey" FOREIGN KEY ("institution_id","attempt_id") REFERENCES "public"."task_attempts"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER "attempt_item_checks_immutable_trigger" BEFORE UPDATE OR DELETE ON "attempt_item_checks" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "attempt_item_checks_truncate_trigger" BEFORE TRUNCATE ON "attempt_item_checks" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();