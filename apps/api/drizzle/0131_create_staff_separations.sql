CREATE TABLE "staff_separations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"separation_date" date NOT NULL,
	"reason" text NOT NULL,
	"sgk_exit_code" text NOT NULL,
	"hire_date" date,
	"notice_given_date" date,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"deductions_checked_at" timestamp with time zone,
	"deductions_checked_by_user_id" text,
	"leave_checked_at" timestamp with time zone,
	"leave_checked_by_user_id" text,
	"severance_checked_at" timestamp with time zone,
	"severance_checked_by_user_id" text,
	"unused_leave_days" integer,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_separations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_separations_reason_check" CHECK ("staff_separations"."reason" in ('resignation', 'termination', 'retirement', 'contract_end', 'other')),
	CONSTRAINT "staff_separations_sgk_code_check" CHECK ("staff_separations"."sgk_exit_code" in ('01', '02', '03', '04', '05', '08', '09', '10', '22', '29')),
	CONSTRAINT "staff_separations_status_check" CHECK ("staff_separations"."status" in ('open', 'completed', 'cancelled')),
	CONSTRAINT "staff_separations_dates_check" CHECK (("staff_separations"."hire_date" is null or "staff_separations"."hire_date" <= "staff_separations"."separation_date")
        and ("staff_separations"."notice_given_date" is null or "staff_separations"."notice_given_date" <= "staff_separations"."separation_date")
        and ("staff_separations"."hire_date" is null or "staff_separations"."notice_given_date" is null
          or "staff_separations"."notice_given_date" >= "staff_separations"."hire_date")),
	CONSTRAINT "staff_separations_note_check" CHECK ("staff_separations"."note" is null or char_length("staff_separations"."note") between 1 and 500),
	CONSTRAINT "staff_separations_marks_check" CHECK (("staff_separations"."deductions_checked_at" is null) = ("staff_separations"."deductions_checked_by_user_id" is null)
        and ("staff_separations"."leave_checked_at" is null) = ("staff_separations"."leave_checked_by_user_id" is null)
        and ("staff_separations"."severance_checked_at" is null) = ("staff_separations"."severance_checked_by_user_id" is null)),
	CONSTRAINT "staff_separations_complete_check" CHECK (("staff_separations"."status" = 'completed') = ("staff_separations"."completed_at" is not null)
        and ("staff_separations"."status" = 'completed') = ("staff_separations"."completed_by_user_id" is not null)
        and ("staff_separations"."unused_leave_days" is null or "staff_separations"."status" = 'completed')),
	CONSTRAINT "staff_separations_cancel_check" CHECK (("staff_separations"."status" = 'cancelled') = ("staff_separations"."cancelled_at" is not null)
        and ("staff_separations"."status" = 'cancelled') = ("staff_separations"."cancelled_by_user_id" is not null)
        and ("staff_separations"."status" = 'cancelled') = ("staff_separations"."cancel_reason" is not null)
        and ("staff_separations"."cancel_reason" is null or char_length("staff_separations"."cancel_reason")
          between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "staff_separations" ADD CONSTRAINT "staff_separations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_separations" ADD CONSTRAINT "staff_separations_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_separations_open_key" ON "staff_separations" USING btree ("institution_id","membership_id") WHERE "staff_separations"."status" = 'open';--> statement-breakpoint
CREATE INDEX "staff_separations_membership_idx" ON "staff_separations" USING btree ("institution_id","membership_id");--> statement-breakpoint
CREATE INDEX "staff_separations_status_idx" ON "staff_separations" USING btree ("institution_id","status","separation_date");--> statement-breakpoint
COMMENT ON TABLE "staff_separations" IS 'İşten ayrılış dosyası (DOM-FIN-118, ON-180, K-403…K-405): personel üyeliğine bağlı ayrılış günü, nedeni, SGK çıkış kodu, işe giriş ve bildirim günü ile kontrol listesi. Zimmet iadesi, hesap kapatma ve hizmet belgesi adımları ilgili tablolardan (fixed_asset_assignments, memberships.deactivated_at, staff_certificates) okunur ve saklanmaz; avans/icra, izin ve kıdem adımlarının işareti buradadır. Zorunlu adımlar bitince dosya tamamlanır (ilişik kesilir), açıkken gerekçeyle iptal edilir; dosya silinmez. Personelin tek açık dosyası olur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."institution_id" IS 'Kurum; dosya ve personel aynı kurumdadır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."id" IS 'Dosya kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."membership_id" IS 'Ayrılan personelin kurum üyeliği (yönetici, öğretmen, ön büro); üyelik silinmez (restrict).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."separation_date" IS 'Ayrılış (son çalışma) günü; dosya bu gün gelmeden tamamlanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."reason" IS 'Ayrılış nedeni: resignation istifa, termination işveren feshi, retirement emeklilik, contract_end sözleşme sonu, other diğer.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."sgk_exit_code" IS 'SGK işten ayrılış nedeni kodu (03 istifa, 04 işveren feshi, 05 belirli süreli sözleşme sonu, 08 emeklilik, 22 diğer …); verilmezse nedenden önerilir (H-85 doğrulanmalı).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."hire_date" IS 'İşe giriş günü; bildirim süresi (4857 md. 17) buradan hesaplanır. Boşsa bildirim bilgisi gösterilmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."notice_given_date" IS 'Fesih bildiriminin yapıldığı gün; bildirim süresinin bittiği gün ve eksik kalan gün bundan hesaplanır, saklanmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."note" IS 'İsteğe bağlı not (1–500 karakter); denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."status" IS 'Dosya durumu: open açık, completed tamamlandı (ilişik kesildi), cancelled iptal edildi. Tamamlanan ve iptal edilen dosya değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."deductions_checked_at" IS 'Avans ve icra kontrolünün işaretlendiği an; kesilecek avans ve süren icra yoksa adım işaretsiz de biter.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."deductions_checked_by_user_id" IS 'Avans ve icra adımını işaretleyen yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."leave_checked_at" IS 'Kullanılmayan yıllık izin gününün kontrol edildiği (bordroya bildirildiği) an.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."leave_checked_by_user_id" IS 'İzin adımını işaretleyen yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."severance_checked_at" IS 'Kıdem ve ihbar hesabının yapıldığı işaret anı; adım zorunlu değildir, hesap sonucu saklanmaz (K-273).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."severance_checked_by_user_id" IS 'Kıdem adımını işaretleyen yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."unused_leave_days" IS 'Tamamlanma anında dondurulan kullanılmayan yıllık izin günü (ayrılış gününde bakiye, eksi olabilir); izin bilgisi yoksa boş. Ücreti bordro hesabında (ON-198).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."completed_at" IS 'Dosyanın tamamlandığı (ilişiğin kesildiği) an.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."completed_by_user_id" IS 'Dosyayı tamamlayan yönetici; ilişik kesme belgesinde düzenleyen.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."cancelled_at" IS 'İptal anı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."cancelled_by_user_id" IS 'İptal eden yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."cancel_reason" IS 'İptal gerekçesi (5–500 karakter); denetim kaydına yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."created_by_user_id" IS 'Dosyayı açan yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."created_at" IS 'Dosyanın açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); dosya silinmez, iptal edilir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_separations"."version" IS 'İyimser kilit sürümü; her yazmada artar (If-Match).';
