CREATE TABLE "department_meeting_attendees" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "department_meeting_attendees_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "department_meeting_attendees_status_check" CHECK ("department_meeting_attendees"."status" in ('attended', 'absent', 'excused'))
);
--> statement-breakpoint
CREATE TABLE "department_meeting_decisions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"agenda_item_id" uuid NOT NULL,
	"text" text NOT NULL,
	"responsible_membership_id" text NOT NULL,
	"due_date" date,
	"status" text NOT NULL,
	"follow_up_note" text,
	"status_changed_at" timestamp with time zone NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "department_meeting_decisions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "department_meeting_decisions_status_check" CHECK ("department_meeting_decisions"."status" in ('open', 'completed', 'cancelled')),
	CONSTRAINT "department_meeting_decisions_text_check" CHECK (char_length("department_meeting_decisions"."text") between 2 and 2000
        and ("department_meeting_decisions"."follow_up_note" is null or char_length("department_meeting_decisions"."follow_up_note") between 1 and 1000)
        and ("department_meeting_decisions"."status" <> 'cancelled' or "department_meeting_decisions"."follow_up_note" is not null))
);
--> statement-breakpoint
CREATE TABLE "department_meetings" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"subject_id" text NOT NULL,
	"subject_name" text NOT NULL,
	"kind" text NOT NULL,
	"meeting_date" date NOT NULL,
	"location" text NOT NULL,
	"chair_membership_id" text NOT NULL,
	"agenda" jsonb NOT NULL,
	"status" text NOT NULL,
	"signed_date" date,
	"finalized_at" timestamp with time zone,
	"finalized_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "department_meetings_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "department_meetings_kind_check" CHECK ("department_meetings"."kind" in ('term_start', 'term_end', 'interim')),
	CONSTRAINT "department_meetings_status_check" CHECK ("department_meetings"."status" in ('draft', 'finalized')),
	CONSTRAINT "department_meetings_text_check" CHECK (char_length("department_meetings"."subject_id") between 1 and 60
        and char_length("department_meetings"."subject_name") between 1 and 120
        and char_length("department_meetings"."location") between 2 and 200),
	CONSTRAINT "department_meetings_agenda_check" CHECK (jsonb_typeof("department_meetings"."agenda") = 'array'
        and jsonb_array_length("department_meetings"."agenda") between 1 and 30),
	CONSTRAINT "department_meetings_finalized_check" CHECK (("department_meetings"."status" = 'draft' and "department_meetings"."signed_date" is null and "department_meetings"."finalized_at" is null and "department_meetings"."finalized_by_user_id" is null)
        or ("department_meetings"."status" = 'finalized' and "department_meetings"."signed_date" is not null and "department_meetings"."finalized_at" is not null
          and "department_meetings"."finalized_by_user_id" is not null and "department_meetings"."signed_date" >= "department_meetings"."meeting_date"))
);
--> statement-breakpoint
ALTER TABLE "department_meeting_attendees" ADD CONSTRAINT "department_meeting_attendees_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_meeting_attendees" ADD CONSTRAINT "department_meeting_attendees_meeting_fkey" FOREIGN KEY ("institution_id","meeting_id") REFERENCES "public"."department_meetings"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_meeting_attendees" ADD CONSTRAINT "department_meeting_attendees_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_meeting_decisions" ADD CONSTRAINT "department_meeting_decisions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_meeting_decisions" ADD CONSTRAINT "department_meeting_decisions_meeting_fkey" FOREIGN KEY ("institution_id","meeting_id") REFERENCES "public"."department_meetings"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_meeting_decisions" ADD CONSTRAINT "department_meeting_decisions_responsible_fkey" FOREIGN KEY ("institution_id","responsible_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_meetings" ADD CONSTRAINT "department_meetings_chair_fkey" FOREIGN KEY ("institution_id","chair_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_meeting_attendees_member_key" ON "department_meeting_attendees" USING btree ("institution_id","meeting_id","membership_id") WHERE "department_meeting_attendees"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "department_meeting_attendees_meeting_idx" ON "department_meeting_attendees" USING btree ("institution_id","meeting_id");--> statement-breakpoint
CREATE INDEX "department_meeting_attendees_membership_idx" ON "department_meeting_attendees" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "department_meeting_decisions_meeting_idx" ON "department_meeting_decisions" USING btree ("institution_id","meeting_id");--> statement-breakpoint
CREATE INDEX "department_meeting_decisions_responsible_idx" ON "department_meeting_decisions" USING btree ("institution_id","responsible_membership_id");--> statement-breakpoint
CREATE INDEX "department_meeting_decisions_due_idx" ON "department_meeting_decisions" USING btree ("institution_id","due_date") WHERE "department_meeting_decisions"."status" = 'open' and "department_meeting_decisions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "department_meetings_date_idx" ON "department_meetings" USING btree ("institution_id","meeting_date");--> statement-breakpoint
CREATE INDEX "department_meetings_subject_idx" ON "department_meetings" USING btree ("institution_id","subject_id","meeting_date");--> statement-breakpoint
CREATE INDEX "department_meetings_chair_idx" ON "department_meetings" USING btree ("institution_id","chair_membership_id");--> statement-breakpoint
-- Kesinleşmiş zümre tutanağı değişmez (DOM-FIN-132, K-453): toplantı satırı kesinleştikten sonra
-- güncellenmez; katılım eklenmez ve değişmez; karar eklenmez, kararın yalnız durumu, takip notu ve
-- durum anı (sürüm ve güncelleme anıyla) değişir. Uygulama aynı kuralı 409 ile verir; bu son güvencedir.
CREATE FUNCTION "kampus_guard_department_meeting"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalized' THEN
    RAISE EXCEPTION 'kampus: finalized department meeting is immutable (%)', TG_OP
      USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "kampus_guard_department_meeting_child"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  meeting_status text;
BEGIN
  SELECT m.status INTO meeting_status FROM "department_meetings" m
    WHERE m.institution_id = NEW.institution_id AND m.id = NEW.meeting_id;
  IF meeting_status IS DISTINCT FROM 'finalized' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'department_meeting_decisions' AND TG_OP = 'UPDATE'
    AND (NEW.meeting_id, NEW.agenda_item_id, NEW.text, NEW.responsible_membership_id, NEW.due_date,
      NEW.created_by_user_id, NEW.created_at, NEW.archived_at)
      IS NOT DISTINCT FROM (OLD.meeting_id, OLD.agenda_item_id, OLD.text, OLD.responsible_membership_id,
      OLD.due_date, OLD.created_by_user_id, OLD.created_at, OLD.archived_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'kampus: finalized department meeting rows are immutable (%)', TG_OP
    USING ERRCODE = '55000', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "department_meetings_finalized_trigger" BEFORE UPDATE ON "department_meetings" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_department_meeting"();--> statement-breakpoint
CREATE TRIGGER "department_meeting_attendees_finalized_trigger" BEFORE INSERT OR UPDATE ON "department_meeting_attendees" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_department_meeting_child"();--> statement-breakpoint
CREATE TRIGGER "department_meeting_decisions_finalized_trigger" BEFORE INSERT OR UPDATE ON "department_meeting_decisions" FOR EACH ROW EXECUTE FUNCTION "kampus_guard_department_meeting_child"();
--> statement-breakpoint
COMMENT ON TABLE "department_meetings" IS 'Zümre toplantısı tutanağı (DOM-FIN-132, ON-217, K-451…K-453): bir dersin (zümre) öğretmenlerinin dönem başı, dönem sonu ya da ara toplantısı; gündem, başkan, yer ve gün. İmza günüyle kesinleşir; kesinleşen satır değişmez (tetikleyici). Satır silinmez. Yalnız yönetici okur ve yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."id" IS 'Toplantı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."subject_id" IS 'Zümrenin dersi: kurumun ders kaydı (subjects) ya da öğretmen kaydının dersi; kurumda ders yoksa müfredat ders kimliği.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."subject_name" IS 'Ders adının toplantı anındaki kopyası (tutanak belgesi ders adı sonradan değişse de aynı kalır; en çok 120).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."kind" IS 'Tür: term_start (dönem başı), term_end (dönem sonu), interim (ara toplantı).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."meeting_date" IS 'Toplantı günü; taslakta ileri bir gün olabilir (gündem önceden hazırlanır).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."location" IS 'Toplantı yeri (2–200).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."chair_membership_id" IS 'Toplantı başkanının kurum üyeliği (memberships, aynı kurum; kişisel veri). Katılımcılar arasında katıldı olarak yer alır.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."agenda" IS 'Gündem maddeleri, görüşülme sırasıyla (jsonb dizi 1–30: id UUID, title 2–300, discussion görüşme özeti en çok 4000 ya da null). Kararlar madde kimliğine bağlanır; kararı olan madde silinmez.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."status" IS 'Durum: draft (taslak, düzeltilir), finalized (kesinleşti; satır değişmez).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."signed_date" IS 'Tutanağın imza günü; yalnız kesinleşmiş tutanakta, toplantı gününden önce ve kesinleştirme gününden sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."finalized_at" IS 'Kesinleştirme anı (UTC); yalnız kesinleşmiş tutanakta.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."finalized_by_user_id" IS 'Tutanağı kesinleştiren yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."created_by_user_id" IS 'Tutanağı açan yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."archived_at" IS 'Kullanılmaz (tutanak silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meetings"."version" IS 'İyimser kilit sürümü (If-Match); katılım ve gündem düzeltmesi de artırır.';
--> statement-breakpoint
COMMENT ON TABLE "department_meeting_attendees" IS 'Zümre toplantısı katılımı (DOM-FIN-132, K-452): personel kurum üyeliğidir (ayrı personel tablosu yok), durum katıldı, katılmadı ya da mazeretli. Mazeretin gerekçesi tutulmaz. Taslakta listeden çıkarılan satır arşivlenir; kesinleşen tutanakta eklenmez ve değişmez (tetikleyici).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_attendees"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_attendees"."id" IS 'Katılım satırı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_attendees"."meeting_id" IS 'Toplantı (department_meetings, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_attendees"."membership_id" IS 'Katılımcının kurum üyeliği (memberships, aynı kurum; kişisel veri). Öğretmen ya da yönetici; etkin satır toplantıda personel başına tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_attendees"."status" IS 'Katılım: attended (katıldı), absent (katılmadı), excused (mazeretli).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_attendees"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_attendees"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_attendees"."archived_at" IS 'Taslakta katılımcı listeden çıkarılınca dolar; arşivli satır tutanakta görünmez.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_attendees"."version" IS 'Satır sürümü (toplantı sürümüyle birlikte yazılır).';
--> statement-breakpoint
COMMENT ON TABLE "department_meeting_decisions" IS 'Zümre toplantısı kararı (DOM-FIN-132, K-452, K-453): gündem maddesine bağlı karar metni, sorumlu personel, termin ve takip. Karar numarası saklanmaz (gündem ve açılış sırasından hesaplanır). Taslakta kaldırılan karar arşivlenir; kesinleşen tutanakta yalnız durum ve takip notu değişir (tetikleyici).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."id" IS 'Karar kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."meeting_id" IS 'Toplantı (department_meetings, aynı kurum).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."agenda_item_id" IS 'Bağlı gündem maddesi; toplantının agenda dizisindeki madde kimliği (uygulama doğrular).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."text" IS 'Karar metni (2–2000); kesinleşen tutanakta değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."responsible_membership_id" IS 'Kararın sorumlusu (memberships, aynı kurum; kişisel veri); öğretmen ya da yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."due_date" IS 'Termin günü (isteğe bağlı); toplantı gününden önce olamaz. Termini geçmiş açık karar listesinin süzgeci.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."status" IS 'Takip durumu: open (açık), completed (tamamlandı), cancelled (iptal; not zorunlu, son durum). Takip yalnız kesinleşmiş tutanakta değişir.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."follow_up_note" IS 'Takip notu (en çok 1000; serbest metin); iptalde gerekçe olarak zorunlu.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."status_changed_at" IS 'Durumun ya da takip notunun son değiştiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."created_by_user_id" IS 'Kararı yazan yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."created_at" IS 'Oluşturulma anı (UTC); aynı maddedeki kararların sırası.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."archived_at" IS 'Taslakta karar kaldırılınca dolar; arşivli karar tutanakta ve listelerde görünmez.';
--> statement-breakpoint
COMMENT ON COLUMN "department_meeting_decisions"."version" IS 'İyimser kilit sürümü (If-Match).';
