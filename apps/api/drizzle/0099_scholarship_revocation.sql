CREATE TABLE "scholarship_terminations" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"award_id" uuid NOT NULL,
	"contract_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"note" text NOT NULL,
	"effective_date" date NOT NULL,
	"kept_cents" bigint NOT NULL,
	"reinstated_cents" bigint NOT NULL,
	"principal_cents" bigint NOT NULL,
	"interest_cents" bigint NOT NULL,
	"clawback_due_date" date,
	"invoice_ids" text[] NOT NULL,
	"lines" jsonb NOT NULL,
	"decided_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "scholarship_terminations_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "scholarship_terminations_kind_check" CHECK ("scholarship_terminations"."kind" in ('terminate', 'revoke')),
	CONSTRAINT "scholarship_terminations_reason_check" CHECK (("scholarship_terminations"."kind" = 'revoke' and "scholarship_terminations"."reason" = 'false_declaration') or ("scholarship_terminations"."kind" = 'terminate' and "scholarship_terminations"."reason" in ('discipline', 'academic', 'attendance', 'institution_decision', 'other'))),
	CONSTRAINT "scholarship_terminations_amounts_check" CHECK ("scholarship_terminations"."kept_cents" >= 0 and "scholarship_terminations"."reinstated_cents" >= 0 and "scholarship_terminations"."principal_cents" >= 0 and "scholarship_terminations"."interest_cents" >= 0),
	CONSTRAINT "scholarship_terminations_clawback_check" CHECK (("scholarship_terminations"."kind" = 'revoke') or ("scholarship_terminations"."principal_cents" = 0 and "scholarship_terminations"."interest_cents" = 0 and "scholarship_terminations"."clawback_due_date" is null))
);
--> statement-breakpoint
ALTER TABLE "scholarship_terminations" ADD CONSTRAINT "scholarship_terminations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scholarship_terminations" ADD CONSTRAINT "scholarship_terminations_award_fkey" FOREIGN KEY ("institution_id","award_id") REFERENCES "public"."scholarship_awards"("institution_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scholarship_terminations_award_kind_key" ON "scholarship_terminations" USING btree ("institution_id","award_id","kind") WHERE "scholarship_terminations"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "scholarship_terminations_contract_idx" ON "scholarship_terminations" USING btree ("institution_id","contract_id");--> statement-breakpoint
COMMENT ON TABLE "scholarship_terminations" IS 'Burs kesmesi ve gerçek dışı beyanla iptali (DOM-FIN-025, ON-283, K-264…K-267). Atama başına en çok bir kesme ve bir iptal; kesmeden sonra iptal yapılabilir. Kesme ileriye etkilidir: kesme gününden sonraki burs payı ayrı öğrenim taksiti olur. İptal uygulanan payı kanuni faiziyle (3095 sayılı Kanun) sözleşme dışı alacak olarak geri ister. Tutarlar yazma anının hesabıdır, sonradan değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."institution_id" IS 'Kurum; her sorgu kurum kapsamlıdır.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."id" IS 'Kesme ya da iptal kaydının kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."award_id" IS 'Kesilen ya da iptal edilen burs ataması (scholarship_awards); atama arşivlenmez, kontenjanda kalır (K-267).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."contract_id" IS 'Bursun yürürlükteki sözleşme sürümü; records kimliğidir, yabancı anahtar değildir (ADR 0010 046h). Yeni burs payı taksitleri bu sürüme bağlanır.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."kind" IS 'terminate: kesme (ileriye etkili); revoke: gerçek dışı beyanla iptal ve geri isteme (geriye etkili).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."reason" IS 'Neden anahtarı: kesmede discipline, academic, attendance, institution_decision ya da other; iptalde yalnız false_declaration.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."note" IS 'Yöneticinin gerekçe açıklaması (2–1000 karakter, kişisel veri içerebilir); loglanmaz, denetim kaydına yalnız alan adı düşer, veli bilgi metnine girmez.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."effective_date" IS 'Kesmede kesme günü (bugün ya da sonrası, eğitim yılı içinde); iptalde geri isteme günü (işlem günü, faizin bittiği gün).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."kept_cents" IS 'Kesmede önceki dönemde uygulanmış kalan burs, kuruş; fon payı bu tutara iner (K-119). İptalde 0.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."reinstated_cents" IS 'İleriye kalkan burs payı, kuruş: yazılan yeni öğrenim taksitlerinin toplamı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."principal_cents" IS 'Geri istenen burs anaparası, kuruş; yalnız iptalde sıfırdan büyük olabilir.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."interest_cents" IS 'Geri istenen kanuni faiz, kuruş: her payın vade gününden geri isteme gününe basit faiz, yıl 365 gün, satır başına aşağı yuvarlanır (K-266).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."clawback_due_date" IS 'Geri isteme alacağının son ödeme günü (geri isteme günü + 30 gün); kesmede boş.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."invoice_ids" IS 'Yazılan taksitlerin records kimlikleri: önce sözleşmeye bağlı burs payı taksitleri, sonra sözleşme dışı anapara ve faiz alacağı.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."lines" IS 'Hesabın satırları (vade, burs payı, durum, faiz günü ve oran parçaları); geri isteme yazısı bu kopyadan üretilir, yeniden hesaplanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."decided_by_user_id" IS 'Kararı işleyen yönetici kullanıcı kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."created_at" IS 'Kaydın yazıldığı an (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."updated_at" IS 'Son güncelleme anı (UTC); kayıt yazıldıktan sonra değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."archived_at" IS 'Arşiv anı; bugün kullanıcı akışı arşivlemez, benzersizlik yalnız arşivlenmemiş kayıtlarda aranır.';--> statement-breakpoint
COMMENT ON COLUMN "scholarship_terminations"."version" IS 'İyimser kilit sürümü.';
