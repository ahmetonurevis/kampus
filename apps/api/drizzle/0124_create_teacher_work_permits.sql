CREATE TABLE "teacher_work_permits" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"permit_type" text NOT NULL,
	"branch" text NOT NULL,
	"status" text NOT NULL,
	"application_date" date,
	"approval_date" date,
	"approval_number" text,
	"valid_until" date,
	"rejection_date" date,
	"rejection_reason" text,
	"document_file_id" uuid,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"cancel_reason" text,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "teacher_work_permits_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "teacher_work_permits_type_check" CHECK ("teacher_work_permits"."permit_type" in ('initial', 'renewal', 'branch_change')),
	CONSTRAINT "teacher_work_permits_status_check" CHECK ("teacher_work_permits"."status" in ('preparing', 'applied', 'approved', 'rejected')),
	CONSTRAINT "teacher_work_permits_branch_check" CHECK (char_length("teacher_work_permits"."branch") between 2 and 80),
	CONSTRAINT "teacher_work_permits_application_check" CHECK (("teacher_work_permits"."status" = 'preparing') = ("teacher_work_permits"."application_date" is null)),
	CONSTRAINT "teacher_work_permits_approval_check" CHECK ((("teacher_work_permits"."status" = 'approved') = ("teacher_work_permits"."approval_date" is not null))
        and (("teacher_work_permits"."status" = 'approved') = ("teacher_work_permits"."approval_number" is not null))
        and ("teacher_work_permits"."status" = 'approved' or "teacher_work_permits"."valid_until" is null)
        and ("teacher_work_permits"."approval_number" is null
          or char_length("teacher_work_permits"."approval_number") between 1 and 60)),
	CONSTRAINT "teacher_work_permits_dates_check" CHECK (("teacher_work_permits"."approval_date" is null or "teacher_work_permits"."approval_date" >= "teacher_work_permits"."application_date")
        and ("teacher_work_permits"."valid_until" is null or "teacher_work_permits"."valid_until" >= "teacher_work_permits"."approval_date")
        and ("teacher_work_permits"."rejection_date" is null or "teacher_work_permits"."rejection_date" >= "teacher_work_permits"."application_date")),
	CONSTRAINT "teacher_work_permits_rejection_check" CHECK ((("teacher_work_permits"."status" = 'rejected') = ("teacher_work_permits"."rejection_date" is not null))
        and (("teacher_work_permits"."status" = 'rejected') = ("teacher_work_permits"."rejection_reason" is not null))
        and ("teacher_work_permits"."rejection_reason" is null or char_length("teacher_work_permits"."rejection_reason")
          between 5 and 500)),
	CONSTRAINT "teacher_work_permits_note_check" CHECK ("teacher_work_permits"."note" is null or char_length("teacher_work_permits"."note") between 1 and 500),
	CONSTRAINT "teacher_work_permits_cancel_check" CHECK ((("teacher_work_permits"."archived_at" is null) = ("teacher_work_permits"."cancel_reason" is null))
        and (("teacher_work_permits"."archived_at" is null) = ("teacher_work_permits"."cancelled_by_user_id" is null))
        and ("teacher_work_permits"."cancel_reason" is null or char_length("teacher_work_permits"."cancel_reason")
          between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "teacher_work_permits" ADD CONSTRAINT "teacher_work_permits_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_work_permits" ADD CONSTRAINT "teacher_work_permits_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_work_permits" ADD CONSTRAINT "teacher_work_permits_document_file_fkey" FOREIGN KEY ("institution_id","document_file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_work_permits_open_key" ON "teacher_work_permits" USING btree ("institution_id","membership_id") WHERE "teacher_work_permits"."status" in ('preparing', 'applied') and "teacher_work_permits"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "teacher_work_permits_membership_idx" ON "teacher_work_permits" USING btree ("institution_id","membership_id","status");--> statement-breakpoint
CREATE INDEX "teacher_work_permits_document_file_idx" ON "teacher_work_permits" USING btree ("institution_id","document_file_id");--> statement-breakpoint
COMMENT ON TABLE "teacher_work_permits" IS 'Öğretmen çalışma onayı takibi (DOM-FIN-114, ON-174, K-375…K-377): özel okul ve kurs öğretmeninin MEBBİS üzerinden alınan çalışma onayının kurum içi kaydı; Kampüs MEBBİS''e göndermez (IST-143). Kayıt öğretmenin kurum üyeliğine bağlıdır (personel tablosu yok). Durum hazırlanıyor, başvuruldu, onaylandı ya da reddedildi; süresi doldu durumu saklanmaz, geçerlilik bitişinden hesaplanır. Öğretmen başına tek açık kayıt (teacher_work_permits_open_key). Yalnız yönetici okur ve yazar; kayıt silinmez, gerekçeyle iptal (arşiv) edilir.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."id" IS 'Kayıt kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."membership_id" IS 'Öğretmenin kurum üyeliği (memberships, aynı kurum); yalnız öğretmen rolü, açılışta etkin olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."permit_type" IS 'Onay türü: initial (ilk onay), renewal (yenileme), branch_change (branş değişikliği); yenileme ve branş değişikliği öğretmenin onaylanmış bir kaydını ister.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."branch" IS 'Onayın istendiği branş (ör. İngilizce), 2–80 karakter, serbest metin.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."status" IS 'Saklanan durum: preparing (hazırlanıyor), applied (başvuruldu), approved (onaylandı), rejected (reddedildi). Onay ve ret yalnız başvurulmuş kayıttan.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."application_date" IS 'MEBBİS başvuru günü; hazırlanan kayıtta boş, diğerlerinde zorunlu; bugünden sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."approval_date" IS 'Onay günü; yalnız onaylı kayıtta, başvuru gününden önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."approval_number" IS 'Onay yazısının sayısı ya da belge numarası (1–60 karakter); yalnız onaylı kayıtta zorunlu.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."valid_until" IS 'Geçerlilik bitişi (dahil); yalnız onaylı kayıtta. Boşsa süresiz. Varsayılan onay gününün eğitim yılı sonudur (K-376); bugünden önceyse kayıt süresi doldu sayılır.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."rejection_date" IS 'Ret günü; yalnız reddedilen kayıtta zorunlu, başvuru gününden önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."rejection_reason" IS 'Ret gerekçesi (5–500 karakter); yalnız reddedilen kayıtta. Denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."document_file_id" IS 'İsteğe bağlı onay belgesi (files, amaç document, PDF; bağ türü teacher_work_permit). Yalnız yönetici açar.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."note" IS 'İsteğe bağlı not (en çok 500 karakter); sonuçlanmış kayıtta da düzeltilebilir.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."created_by_user_id" IS 'Kaydı açan yönetici kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."cancel_reason" IS 'İptal (arşiv) gerekçesi, 5–500 karakter; yalnız iptal edilmiş kayıtta. Denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."cancelled_by_user_id" IS 'Kaydı iptal eden kullanıcı; yalnız iptal edilmiş kayıtta.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."archived_at" IS 'İptal (arşiv) anı; doluysa kayıt okunmaz ve takipte sayılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "teacher_work_permits"."version" IS 'İyimser kilit sürümü (If-Match).';
