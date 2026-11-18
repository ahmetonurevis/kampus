CREATE TABLE "staff_leave_request_lessons" (
	"institution_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration" integer NOT NULL,
	"class_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"title" text NOT NULL,
	"substitute_teacher_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_leave_request_lessons_pkey" PRIMARY KEY("institution_id","request_id","lesson_id"),
	CONSTRAINT "staff_leave_request_lessons_duration_check" CHECK ("staff_leave_request_lessons"."duration" between 0 and 1440),
	CONSTRAINT "staff_leave_request_lessons_title_check" CHECK (char_length("staff_leave_request_lessons"."title") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "staff_leave_requests" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"type_code" text NOT NULL,
	"kind" text NOT NULL,
	"type_label" text NOT NULL,
	"deducts_from_annual" boolean NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" text,
	"reject_reason" text,
	"advance_approved" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_leave_requests_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_leave_requests_status_check" CHECK ("staff_leave_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "staff_leave_requests_kind_check" CHECK ("staff_leave_requests"."kind" in ('annual', 'excuse', 'unpaid', 'sick', 'other') and "staff_leave_requests"."kind" <> 'sick'),
	CONSTRAINT "staff_leave_requests_dates_check" CHECK ("staff_leave_requests"."end_date" >= "staff_leave_requests"."start_date"
        and "staff_leave_requests"."days" between 1 and least(366,
          "staff_leave_requests"."end_date" - "staff_leave_requests"."start_date" + 1)),
	CONSTRAINT "staff_leave_requests_label_check" CHECK (char_length("staff_leave_requests"."type_label") between 2 and 80),
	CONSTRAINT "staff_leave_requests_description_check" CHECK ("staff_leave_requests"."description" is null
        or char_length("staff_leave_requests"."description") between 1 and 500),
	CONSTRAINT "staff_leave_requests_decision_check" CHECK ((("staff_leave_requests"."decided_at" is null) = ("staff_leave_requests"."decided_by_user_id" is null))
        and ("staff_leave_requests"."status" <> 'pending' or "staff_leave_requests"."decided_at" is null)
        and ("staff_leave_requests"."status" not in ('approved', 'rejected') or "staff_leave_requests"."decided_at" is not null)
        and (("staff_leave_requests"."status" = 'rejected') = ("staff_leave_requests"."reject_reason" is not null))
        and ("staff_leave_requests"."reject_reason" is null or char_length("staff_leave_requests"."reject_reason")
          between 5 and 500)
        and (not "staff_leave_requests"."advance_approved" or "staff_leave_requests"."decided_at" is not null)),
	CONSTRAINT "staff_leave_requests_cancel_check" CHECK ((("staff_leave_requests"."status" = 'cancelled') = ("staff_leave_requests"."cancelled_at" is not null))
        and (("staff_leave_requests"."cancelled_at" is null) = ("staff_leave_requests"."cancelled_by_user_id" is null))
        and (("staff_leave_requests"."cancelled_at" is null) = ("staff_leave_requests"."cancel_reason" is null))
        and ("staff_leave_requests"."cancel_reason" is null or char_length("staff_leave_requests"."cancel_reason")
          between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "staff_leave_records" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_leave_request_lessons" ADD CONSTRAINT "staff_leave_request_lessons_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_request_lessons" ADD CONSTRAINT "staff_leave_request_lessons_request_fkey" FOREIGN KEY ("institution_id","request_id") REFERENCES "public"."staff_leave_requests"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_requests" ADD CONSTRAINT "staff_leave_requests_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_requests" ADD CONSTRAINT "staff_leave_requests_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_leave_requests_membership_idx" ON "staff_leave_requests" USING btree ("institution_id","membership_id","start_date");--> statement-breakpoint
CREATE INDEX "staff_leave_requests_status_idx" ON "staff_leave_requests" USING btree ("institution_id","status","start_date");--> statement-breakpoint
ALTER TABLE "staff_leave_records" ADD CONSTRAINT "staff_leave_records_request_fkey" FOREIGN KEY ("institution_id","request_id") REFERENCES "public"."staff_leave_requests"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_leave_records_request_key" ON "staff_leave_records" USING btree ("institution_id","request_id") WHERE "staff_leave_records"."request_id" is not null;--> statement-breakpoint
COMMENT ON TABLE "staff_leave_requests" IS 'Personel izin talebi (DOM-FIN-116, ON-182, K-397…K-399). Durum: pending (onay bekliyor) → approved (onaylandı) ya da rejected (reddedildi, gerekçeli); bekleyen ya da onaylı talep gerekçeyle cancelled (iptal) olur. Onaylanan talep kullanılmış izin kaydını üretir (staff_leave_records.request_id); onaylı talebin iptali o kaydı da iptal eder. Aynı personelde bekleyen ve onaylı talepler çakışmaz (kurum kilidi altında servis denetimi). Silinmez; yalnız yönetici yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."id" IS 'Talep kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."membership_id" IS 'İzin isteyen personelin kurum üyeliği (yönetici, öğretmen ya da ön büro). Üyelik silinirse talep korunur: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."type_code" IS 'İstenen izin türü kodu (varsayılan tür ya da staff_leave_types.code).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."kind" IS 'Talep anındaki tür biçimi (annual, excuse, unpaid, other); rapor (sick) talep edilmez, sağlık raporu kaydındadır (ON-185).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."type_label" IS 'Talep anındaki tür adı (gösterim kopyası); onay türün güncel ayarıyla kayıt yazar.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."deducts_from_annual" IS 'Talep anında tür yıllık izinden düşüyor muydu (gösterim kopyası).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."start_date" IS 'İznin ilk günü.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."end_date" IS 'İznin son günü (dahil).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."days" IS 'İstenen iş günü (tam gün; yarım gün yok). 1 ile aralığın takvim günü arasında.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."description" IS 'İsteğe bağlı açıklama (1–500 karakter). Kişisel veri; loga ve denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."status" IS 'Durum: pending, approved, rejected, cancelled.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."requested_by_user_id" IS 'Talebi personel adına açan kullanıcı (bugün yönetici; self-servis ON-189).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."decided_at" IS 'Onay ya da ret anı (UTC); bekleyen ve onaylanmadan iptal edilen talepte boş.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."decided_by_user_id" IS 'Onaylayan ya da reddeden yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."reject_reason" IS 'Ret gerekçesi (5–500 karakter); yalnız reddedilen talepte. Denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."advance_approved" IS 'Yetersiz yıllık izin bakiyesine rağmen avans izin olarak onaylandı mı (K-398).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."cancelled_at" IS 'İptal anı (UTC); yalnız iptal edilen talepte.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."cancelled_by_user_id" IS 'Talebi iptal eden yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter). Denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."created_at" IS 'Talebin açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."archived_at" IS 'Kullanılmaz (talep silinmez, iptal durumla tutulur); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_requests"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "staff_leave_request_lessons" IS 'İzin talebinin etkilediği ders ve yedek öğretmen bağı (DOM-FIN-116, K-399). Talep açılırken ders programından (records, schedule koleksiyonu) personelin bağlı öğretmen kaydının izin aralığındaki iptal edilmemiş dersleri kopyalanır. Yedek öğretmen elle seçilir; bağ ders programına yazılmaz (yedek ataması ders programı komutuyla yapılır, öneri OG-843).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."request_id" IS 'Bağlı izin talebi (staff_leave_requests). Talep silinmez: restrict.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."lesson_id" IS 'Ders programındaki ders kimliği (records.id, schedule koleksiyonu); yabancı anahtar yok, ders sonradan iptal edilebilir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."starts_at" IS 'Talep anında dersin başlangıcı (UTC kopya).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."duration" IS 'Talep anında ders süresi (dakika, 0–1440).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."class_id" IS 'Talep anında dersin sınıfı (records kimliği).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."subject_id" IS 'Talep anında dersin branşı (records kimliği); başka branştan yedek uyarısı için.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."title" IS 'Talep anında ders adı (1–120 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."substitute_teacher_id" IS 'Elle seçilen yedek öğretmen kaydı (records teachers kimliği); boşsa seçilmemiş.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."created_at" IS 'Satırın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."updated_at" IS 'Yedek seçiminin son değiştiği an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."archived_at" IS 'Kullanılmaz (satır silinmez); zorunlu kolon.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_request_lessons"."version" IS 'Satır sürümü; yedek değişikliğinde artar.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_leave_records"."request_id" IS 'Kaydı üreten izin talebi (staff_leave_requests; DOM-FIN-116). Elle yazılmış kayıtta boş. Talepten doğan kayıt yalnız talebin iptaliyle iptal edilir. Talep başına en çok bir kayıt.';
