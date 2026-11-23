-- Veli–öğrenci bağı (OG-031, IST-019; DOM-ILT-070…075). Tablo yenidir; kısıtlar tek adımda
-- eklenir. Tek ödeyici (`student_guardians_payer_key`) ve kısıtlı velinin velayetli/ödeyici/teslim
-- alan olamaması (`student_guardians_restriction_check`) core kuralıyla aynıdır; bağı olan
-- öğrencide en az bir velayetli bağ kuralı satırlar arası olduğundan core'da, kurum kilidi altında
-- denetlenir.
CREATE TABLE "student_guardians" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"parent_id" text,
	"membership_id" text,
	"relationship" text NOT NULL,
	"custody" text NOT NULL,
	"is_contact_restricted" boolean DEFAULT false NOT NULL,
	"is_payer" boolean DEFAULT false NOT NULL,
	"is_pickup_authorized" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "student_guardians_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "student_guardians_relationship_check" CHECK ("student_guardians"."relationship" in ('mother', 'father', 'legal_guardian', 'other')),
	CONSTRAINT "student_guardians_custody_check" CHECK ("student_guardians"."custody" in ('full', 'joint', 'none')),
	CONSTRAINT "student_guardians_identity_check" CHECK ("student_guardians"."parent_id" is not null or "student_guardians"."membership_id" is not null),
	CONSTRAINT "student_guardians_restriction_check" CHECK (not "student_guardians"."is_contact_restricted" or ("student_guardians"."custody" = 'none' and not "student_guardians"."is_payer" and not "student_guardians"."is_pickup_authorized"))
);
--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_guardians_payer_key" ON "student_guardians" USING btree ("institution_id","student_id") WHERE "student_guardians"."is_payer" and "student_guardians"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "student_guardians_student_parent_key" ON "student_guardians" USING btree ("institution_id","student_id","parent_id") WHERE "student_guardians"."parent_id" is not null and "student_guardians"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "student_guardians_student_membership_key" ON "student_guardians" USING btree ("institution_id","student_id","membership_id") WHERE "student_guardians"."membership_id" is not null and "student_guardians"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "student_guardians_student_idx" ON "student_guardians" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "student_guardians_membership_idx" ON "student_guardians" USING btree ("institution_id","membership_id");--> statement-breakpoint
-- Geri doldurma (elle eklendi): kurumun kurduğu ve doğrulanmış sayılan her etkin veli hesabı
-- bağlantısı (`membership_links` `child`) velayetli (`full`), kısıtsız, ödeyici ve teslim alma
-- yetkisi olmayan bağ olur; yakınlık bilinmediğinden `other`. Rıza velayeti artık bu tablodan okur.
INSERT INTO "student_guardians" ("institution_id", "id", "student_id", "membership_id", "relationship", "custody")
SELECT "institution_id", gen_random_uuid(), "record_id", "membership_id", 'other', 'full'
FROM "membership_links"
WHERE "kind" = 'child' AND "archived_at" IS NULL;
