-- Dinleme hakkı sayımı (OG-049, IST-045; ADR 0003 karar 6, ADR 0004 karar 6; DOM-BEC-005).
-- Tablo yenidir; kısıtlar `not valid` adımı olmadan tek adımda eklenir. Numara 0030 görev
-- satırında ayrıldı. Deneme ve dosya `(institution_id, …_id)` bileşik yabancı anahtarlarıyla
-- bağlanır; tekil `(institution_id, attempt_id, file_id, play_number)` eşzamanlı iki sayımdan
-- birini reddeder, `play_number` core'un en büyük hakkını (2) aşamaz.
-- Elle eklenen: dosyanın sonundaki değişmez satır tetikleyicileri (Drizzle tetikleyici üretmez;
-- işlev `kampus_reject_immutable_change` migration 0013'tedir). Her `update`/`delete`/`truncate`
-- 55000 ile reddedilir; yalnız imha işi `set local kampus.allow_immutable_purge = 'on'` ile siler.
CREATE TABLE "attempt_media_plays" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"play_number" integer NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "attempt_media_plays_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "attempt_media_plays_play_number_check" CHECK ("attempt_media_plays"."play_number" in (1, 2)),
	CONSTRAINT "attempt_media_plays_version_check" CHECK ("attempt_media_plays"."version" = 1 and "attempt_media_plays"."archived_at" is null)
);
--> statement-breakpoint
ALTER TABLE "attempt_media_plays" ADD CONSTRAINT "attempt_media_plays_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_media_plays" ADD CONSTRAINT "attempt_media_plays_attempt_fkey" FOREIGN KEY ("institution_id","attempt_id") REFERENCES "public"."task_attempts"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_media_plays" ADD CONSTRAINT "attempt_media_plays_file_fkey" FOREIGN KEY ("institution_id","file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_media_plays_attempt_file_number_key" ON "attempt_media_plays" USING btree ("institution_id","attempt_id","file_id","play_number");--> statement-breakpoint
CREATE INDEX "attempt_media_plays_file_idx" ON "attempt_media_plays" USING btree ("institution_id","file_id");--> statement-breakpoint
CREATE TRIGGER "attempt_media_plays_immutable_trigger" BEFORE UPDATE OR DELETE ON "attempt_media_plays" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "attempt_media_plays_truncate_trigger" BEFORE TRUNCATE ON "attempt_media_plays" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
