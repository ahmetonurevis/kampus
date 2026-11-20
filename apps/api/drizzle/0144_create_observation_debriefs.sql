CREATE TABLE "observation_debrief_participants" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"debrief_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "observation_debrief_participants_pkey" PRIMARY KEY("institution_id","id")
);
--> statement-breakpoint
CREATE TABLE "observation_debriefs" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"debrief_date" date NOT NULL,
	"strengths" text,
	"development_areas" text,
	"teacher_comment" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "observation_debriefs_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "observation_debriefs_status_check" CHECK ("observation_debriefs"."status" in ('draft', 'finalized')),
	CONSTRAINT "observation_debriefs_text_check" CHECK (("observation_debriefs"."strengths" is null or char_length("observation_debriefs"."strengths") between 1 and 4000)
        and ("observation_debriefs"."development_areas" is null or char_length("observation_debriefs"."development_areas") between 1 and 4000)
        and ("observation_debriefs"."teacher_comment" is null or char_length("observation_debriefs"."teacher_comment") between 1 and 4000)),
	CONSTRAINT "observation_debriefs_finalized_check" CHECK ((("observation_debriefs"."status" = 'finalized') = ("observation_debriefs"."finalized_at" is not null))
        and (("observation_debriefs"."finalized_at" is null) = ("observation_debriefs"."finalized_by_user_id" is null))
        and ("observation_debriefs"."status" = 'draft'
          or ("observation_debriefs"."strengths" is not null and "observation_debriefs"."development_areas" is not null)))
);
--> statement-breakpoint
CREATE TABLE "staff_development_goal_notes" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"note" text NOT NULL,
	"status_from" text NOT NULL,
	"status_to" text,
	"next_follow_up_date" date,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_development_goal_notes_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_development_goal_notes_status_check" CHECK ("staff_development_goal_notes"."status_from" in ('open', 'in_progress', 'achieved', 'dropped')
        and ("staff_development_goal_notes"."status_to" is null or "staff_development_goal_notes"."status_to" in ('open', 'in_progress', 'achieved', 'dropped'))),
	CONSTRAINT "staff_development_goal_notes_note_check" CHECK (char_length("staff_development_goal_notes"."note") between 2 and 1000)
);
--> statement-breakpoint
CREATE TABLE "staff_development_goals" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"teacher_membership_id" text NOT NULL,
	"source" text NOT NULL,
	"debrief_id" uuid,
	"performance_period_id" uuid,
	"title" text NOT NULL,
	"success_criterion" text NOT NULL,
	"follow_up_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_development_goals_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_development_goals_status_check" CHECK ("staff_development_goals"."status" in ('open', 'in_progress', 'achieved', 'dropped')),
	CONSTRAINT "staff_development_goals_source_check" CHECK ("staff_development_goals"."source" in ('observation_debrief', 'direct')),
	CONSTRAINT "staff_development_goals_source_debrief_check" CHECK (("staff_development_goals"."source" = 'observation_debrief') = ("staff_development_goals"."debrief_id" is not null)),
	CONSTRAINT "staff_development_goals_text_check" CHECK (char_length("staff_development_goals"."title") between 2 and 500
        and char_length("staff_development_goals"."success_criterion") between 2 and 1000),
	CONSTRAINT "staff_development_goals_closed_check" CHECK (("staff_development_goals"."status" in ('achieved', 'dropped')) = ("staff_development_goals"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "observation_debrief_participants" ADD CONSTRAINT "observation_debrief_participants_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_debrief_participants" ADD CONSTRAINT "observation_debrief_participants_debrief_fkey" FOREIGN KEY ("institution_id","debrief_id") REFERENCES "public"."observation_debriefs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_debrief_participants" ADD CONSTRAINT "observation_debrief_participants_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_debriefs" ADD CONSTRAINT "observation_debriefs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_debriefs" ADD CONSTRAINT "observation_debriefs_observation_fkey" FOREIGN KEY ("institution_id","observation_id") REFERENCES "public"."lesson_observations"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_development_goal_notes" ADD CONSTRAINT "staff_development_goal_notes_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_development_goal_notes" ADD CONSTRAINT "staff_development_goal_notes_goal_fkey" FOREIGN KEY ("institution_id","goal_id") REFERENCES "public"."staff_development_goals"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_development_goals" ADD CONSTRAINT "staff_development_goals_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_development_goals" ADD CONSTRAINT "staff_development_goals_teacher_fkey" FOREIGN KEY ("institution_id","teacher_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_development_goals" ADD CONSTRAINT "staff_development_goals_debrief_fkey" FOREIGN KEY ("institution_id","debrief_id") REFERENCES "public"."observation_debriefs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_development_goals" ADD CONSTRAINT "staff_development_goals_period_fkey" FOREIGN KEY ("institution_id","performance_period_id") REFERENCES "public"."performance_periods"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "observation_debrief_participants_member_key" ON "observation_debrief_participants" USING btree ("institution_id","debrief_id","membership_id") WHERE "observation_debrief_participants"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "observation_debrief_participants_debrief_idx" ON "observation_debrief_participants" USING btree ("institution_id","debrief_id");--> statement-breakpoint
CREATE INDEX "observation_debrief_participants_membership_idx" ON "observation_debrief_participants" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "observation_debriefs_observation_key" ON "observation_debriefs" USING btree ("institution_id","observation_id");--> statement-breakpoint
CREATE INDEX "observation_debriefs_date_idx" ON "observation_debriefs" USING btree ("institution_id","debrief_date");--> statement-breakpoint
CREATE INDEX "staff_development_goal_notes_goal_idx" ON "staff_development_goal_notes" USING btree ("institution_id","goal_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_development_goals_teacher_idx" ON "staff_development_goals" USING btree ("institution_id","teacher_membership_id");--> statement-breakpoint
CREATE INDEX "staff_development_goals_debrief_idx" ON "staff_development_goals" USING btree ("institution_id","debrief_id");--> statement-breakpoint
CREATE INDEX "staff_development_goals_period_idx" ON "staff_development_goals" USING btree ("institution_id","performance_period_id");--> statement-breakpoint
CREATE INDEX "staff_development_goals_follow_up_idx" ON "staff_development_goals" USING btree ("institution_id","status","follow_up_date");--> statement-breakpoint
-- Kesinleşmiş gözlem görüşmesi değişmez (DOM-FIN-133, K-454): görüşme satırı kesinleştikten sonra
-- güncellenmez; katılım eklenmez ve değişmez. Uygulama aynı kuralı 409 ile verir; bu son güvencedir.
CREATE FUNCTION "kampus_guard_observation_debrief"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalized' THEN
    RAISE EXCEPTION 'kampus: finalized observation debrief is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "kampus_guard_observation_debrief_participant"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  debrief_status text;
BEGIN
  SELECT d.status INTO debrief_status FROM "observation_debriefs" d
    WHERE d.institution_id = NEW.institution_id AND d.id = NEW.debrief_id;
  IF debrief_status IS DISTINCT FROM 'finalized' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'kampus: finalized observation debrief participants are immutable (%)', TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "observation_debriefs_finalized_trigger" BEFORE UPDATE ON "observation_debriefs" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_observation_debrief"();--> statement-breakpoint
CREATE TRIGGER "observation_debrief_participants_finalized_trigger" BEFORE INSERT OR UPDATE ON "observation_debrief_participants" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_observation_debrief_participant"();--> statement-breakpoint
CREATE TRIGGER "staff_development_goal_notes_immutable_trigger" BEFORE UPDATE OR DELETE ON "staff_development_goal_notes" FOR EACH ROW EXECUTE FUNCTION "kampus_reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "staff_development_goal_notes_truncate_trigger" BEFORE TRUNCATE ON "staff_development_goal_notes" FOR EACH STATEMENT EXECUTE FUNCTION "kampus_reject_immutable_change"();
--> statement-breakpoint
COMMENT ON TABLE "observation_debriefs" IS 'Gözlem sonrası görüşme (DOM-FIN-133, ON-209, K-454): tamamlanmış ders gözlemine (lesson_observations) en çok bir görüşme; gün, güçlü yönler, gelişim alanları, öğretmenin görüşü. Taslak düzeltilir; kesinleşen satır değişmez (tetikleyici). Kişisel veri: yönetici, gözlemci ve kesinleşince gözlenen öğretmen görür; okuma audit_log''a düşer (K-456).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."id" IS 'Görüşme kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."observation_id" IS 'Görüşülen ders gözlemi (lesson_observations, aynı kurum); açılışta tamamlanmış olmalı, gözlem başına tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."debrief_date" IS 'Görüşme günü; gözlem gününden önce ve kayıt anındaki bugünden sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."strengths" IS 'Güçlü yönler (1–4000); kesinleştirmek için zorunlu, loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."development_areas" IS 'Gelişim alanları (1–4000); kesinleştirmek için zorunlu, loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."teacher_comment" IS 'Öğretmenin görüşü (1–4000); isteğe bağlı, loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."status" IS 'Durum: draft (taslak, düzeltilebilir) ya da finalized (kesinleşti, değişmez).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."finalized_at" IS 'Kesinleşme anı (UTC); yalnız finalized iken dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."finalized_by_user_id" IS 'Görüşmeyi kesinleştiren yönetici; finalized_at ile birlikte dolar.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."created_by_user_id" IS 'Görüşmeyi açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."archived_at" IS 'Kullanılmaz (görüşme silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debriefs"."version" IS 'Satır sürümü; düzeltme ve kesinleştirmede If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "observation_debrief_participants" IS 'Gözlem görüşmesine katılanlar (DOM-FIN-133, K-454): kurumun yönetici ya da öğretmen üyeliği; gözlenen öğretmen her zaman listede. Taslakta çıkarılan katılımcı arşivlenir; kesinleşmiş görüşmenin katılımı değişmez (tetikleyici).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debrief_participants"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debrief_participants"."id" IS 'Katılım satırı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debrief_participants"."debrief_id" IS 'Görüşme (observation_debriefs, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debrief_participants"."membership_id" IS 'Katılanın kurum üyeliği (memberships, aynı kurum); etkin satır görüşmede tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debrief_participants"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debrief_participants"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debrief_participants"."archived_at" IS 'Taslakta listeden çıkarılma anı; arşivli satır katılımcı sayılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "observation_debrief_participants"."version" IS 'Satır sürümü.';
--> statement-breakpoint
COMMENT ON TABLE "staff_development_goals" IS 'Personel gelişim hedefi (DOM-FIN-133, ON-209, K-455): genel kayıt; kaynak gözlem görüşmesi ya da doğrudan, isteğe bağlı performans dönemi (DOM-FIN-124). Hedef, ölçüt, takip tarihi ve durum (open, in_progress, achieved, dropped). Kapanan hedef değişmez. Performans raporu (ON-220) okur. Kişisel veri: yönetici, ilgili öğretmen ve kaynak gözlemin gözlemcisi görür; okuma audit_log''a düşer (K-456).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."id" IS 'Hedef kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."teacher_membership_id" IS 'Hedefin öğretmeni (memberships, aynı kurum); açılışta etkin öğretmen. Kaynak görüşmeyse gözlemin öğretmeni.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."source" IS 'Kaynak: observation_debrief (gözlem görüşmesi; debrief_id dolu) ya da direct (doğrudan; debrief_id boş).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."debrief_id" IS 'Kaynak gözlem görüşmesi (observation_debriefs, aynı kurum); yalnız source = observation_debrief iken dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."performance_period_id" IS 'İsteğe bağlı performans dönemi (performance_periods, DOM-FIN-124); kapanmış döneme bağlanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."title" IS 'Hedef metni (2–500).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."success_criterion" IS 'Ölçüt: hedefe ulaşıldığı neyle anlaşılır (2–1000).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."follow_up_date" IS 'Takip tarihi; açılış ve değişiklikte bugünden önce olamaz. Süren hedefte İstanbul gününe göre geçmişse gecikmiş sayılır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."status" IS 'Durum: open (açık), in_progress (sürüyor), achieved (ulaşıldı), dropped (bırakıldı). Yalnız ileri gider; son iki durum kapalıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."closed_at" IS 'Kapanma anı (UTC); yalnız achieved ya da dropped iken dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."created_by_user_id" IS 'Hedefi açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."archived_at" IS 'Kullanılmaz (hedef silinmez, bırakıldı durumuna geçer); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goals"."version" IS 'Satır sürümü; düzeltme ve takip notunda If-Match ile denetlenir.';
--> statement-breakpoint
COMMENT ON TABLE "staff_development_goal_notes" IS 'Gelişim hedefi takip geçmişi (DOM-FIN-133, K-455): her takip notu, durum değişikliği ve yeni takip tarihi bir satır. Yalnız eklenir; değişmez ve silinmez (kampus_reject_immutable_change).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."id" IS 'Not kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."goal_id" IS 'Hedef (staff_development_goals, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."note" IS 'Takip notu (2–1000); loglanmaz ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."status_from" IS 'Not yazıldığında hedefin durumu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."status_to" IS 'Notla geçilen yeni durum; durum değişmediyse boş.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."next_follow_up_date" IS 'Notla verilen sonraki takip tarihi; değişmediyse boş.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."created_by_user_id" IS 'Notu yazan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."created_at" IS 'Not anı (UTC); geçmiş bu sırayla okunur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."updated_at" IS 'Oluşturulma anıyla aynı; satır değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."archived_at" IS 'Kullanılmaz (geçmiş silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_development_goal_notes"."version" IS 'Satır sürümü; hep 1.';
