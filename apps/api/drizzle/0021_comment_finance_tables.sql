-- Türkçe tablo ve kolon açıklamaları: tahsilat, tarife, kimlik, ayrılış (ADR 0006).
COMMENT ON TABLE "payments" IS 'Tahsilat kaydı. Silinmez, tutarı değişmez; iptal aynı satıra gerekçeyle yazılır (DOM-FIN-030, -033).';--> statement-breakpoint
COMMENT ON COLUMN "payments"."institution_id" IS 'Kurum; kayıtlar kurum dışına çıkmaz.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."id" IS 'Tahsilat kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."student_id" IS 'Öğrenci; records kimliğidir, yabancı anahtar değildir.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."amount_cents" IS 'Tahsil edilen tutar, kuruş; sıfırdan büyük.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."method" IS 'Yöntem: bank_transfer, cash, card. Nakit kurum ayarına bağlıdır.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."reference" IS 'Banka veya POS işlem referansı; iptal edilmemiş satırlarda kurum içinde tekil.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."paid_at" IS 'Ödeme anı.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."receipt_year" IS 'Dekont yılı (Europe/Istanbul, kayıt anı).';--> statement-breakpoint
COMMENT ON COLUMN "payments"."receipt_number" IS 'Kurum ve yıl içinde ardışık dekont numarası.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."recorded_by_user_id" IS 'Tahsilatı kaydeden kullanıcı.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."reversed_at" IS 'İptal anı; iptal edilmediyse boş.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."reversed_by_user_id" IS 'İptal eden yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."reversal_reason" IS 'İptal gerekçesi; veli ve öğrenciye dönmez.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."created_at" IS 'Satırın oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."updated_at" IS 'Satırın son değişme anı.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."archived_at" IS 'Arşiv anı; tahsilat arşivlenmez, ortak kolondur.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "payment_allocations" IS 'Tahsilatın taksitlere dağılımı; önce seçilen taksit, sonra en eski vade (DOM-FIN-030).';--> statement-breakpoint
COMMENT ON COLUMN "payment_allocations"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "payment_allocations"."payment_id" IS 'Tahsilat; payments ile bileşik yabancı anahtar.';--> statement-breakpoint
COMMENT ON COLUMN "payment_allocations"."invoice_id" IS 'Taksit; records kimliğidir, yabancı anahtar değildir.';--> statement-breakpoint
COMMENT ON COLUMN "payment_allocations"."amount_cents" IS 'Taksite dağıtılan tutar, kuruş.';--> statement-breakpoint
COMMENT ON COLUMN "payment_allocations"."created_at" IS 'Satırın oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "payment_allocations"."updated_at" IS 'Satırın son değişme anı.';--> statement-breakpoint
COMMENT ON COLUMN "payment_allocations"."archived_at" IS 'Arşiv anı; ortak kolondur.';--> statement-breakpoint
COMMENT ON COLUMN "payment_allocations"."version" IS 'İyimser kilit sürümü.';--> statement-breakpoint
COMMENT ON TABLE "payment_settings" IS 'Kurumun tahsilat ayarı. Satır yoksa nakit kapalıdır (ADR 0006 karar 7).';--> statement-breakpoint
COMMENT ON COLUMN "payment_settings"."institution_id" IS 'Kurum; kurum başına tek satır.';--> statement-breakpoint
COMMENT ON COLUMN "payment_settings"."cash_payments_enabled" IS 'Nakit tahsilat açık mı; yalnız yönetici değiştirir.';--> statement-breakpoint
COMMENT ON COLUMN "payment_settings"."created_at" IS 'Satırın oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "payment_settings"."updated_at" IS 'Satırın son değişme anı.';--> statement-breakpoint
COMMENT ON COLUMN "payment_settings"."archived_at" IS 'Arşiv anı; ortak kolondur.';--> statement-breakpoint
COMMENT ON COLUMN "payment_settings"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "fee_tariffs" IS 'Eğitim yılı başına sürümlü ücret tarifesi. Yayımlanan sürüm değişmez (DOM-FIN-002).';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."id" IS 'Tarife sürümü kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."academic_year" IS 'Eğitim yılının başlangıç yılı.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."version_number" IS 'Yıl içinde sürüm numarası.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."status" IS 'Durum: draft, published, superseded. Yılda tek açık taslak ve tek yayın.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."items" IS 'Ücret kalemleri (tür, düzey, tutar, birim, tarihli KDV, onaylı tutar).';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."discounts" IS 'İlan edilen indirim türleri ve oran veya tutarları.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."announced_date" IS 'İlan günü.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."mebbis_recorded_date" IS 'MEBBİS''e işlendiği gün.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."published_by_user_id" IS 'Yayımlayan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."published_at" IS 'Yayım anı.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."created_at" IS 'Satırın oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."updated_at" IS 'Satırın son değişme anı.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."archived_at" IS 'Arşiv anı; ortak kolondur.';--> statement-breakpoint
COMMENT ON COLUMN "fee_tariffs"."version" IS 'İyimser kilit sürümü (If-Match).';--> statement-breakpoint
COMMENT ON TABLE "student_identities" IS 'Öğrenci kimlik verisi; genel okumaya kapalı, yanıtlarda maskeli (DOM-KAY-011, -012).';--> statement-breakpoint
COMMENT ON COLUMN "student_identities"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "student_identities"."student_id" IS 'Öğrenci; records kimliğidir.';--> statement-breakpoint
COMMENT ON COLUMN "student_identities"."academic_year" IS 'Kaydın alındığı eğitim yılı.';--> statement-breakpoint
COMMENT ON COLUMN "student_identities"."identity_kind" IS 'Kimlik türü: tc, foreign.';--> statement-breakpoint
COMMENT ON COLUMN "student_identities"."identity_number" IS 'Kimlik numarası; arşivlenmemiş satırlarda kurum içinde tekil, loglanmaz.';--> statement-breakpoint
COMMENT ON COLUMN "student_identities"."birth_date" IS 'Doğum tarihi.';--> statement-breakpoint
COMMENT ON COLUMN "student_identities"."created_at" IS 'Satırın oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "student_identities"."updated_at" IS 'Satırın son değişme anı.';--> statement-breakpoint
COMMENT ON COLUMN "student_identities"."archived_at" IS 'Ayrılış veya yeniden kayıtta dolar; kimlik yeniden kullanılabilir.';--> statement-breakpoint
COMMENT ON COLUMN "student_identities"."version" IS 'İyimser kilit sürümü.';--> statement-breakpoint
COMMENT ON TABLE "student_withdrawals" IS 'Ayrılış ve iade kaydı; hesap dökümü karar anının kopyasıdır (DOM-FIN-041, DOM-KAY-024).';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."id" IS 'Ayrılış kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."student_id" IS 'Öğrenci; records kimliğidir.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."contract_id" IS 'Sözleşme; records kimliğidir, sözleşme başına tek ayrılış.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."withdrawal_date" IS 'Ayrılış günü.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."reason" IS 'Neden: transfer, relocation, health, financial, dissatisfaction, other.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."target_school" IS 'Gittiği okul.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."breakdown" IS 'Hesap dökümü: girdi, oran ve kalemler; sonradan değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."refund_cents" IS 'İade tutarı, kuruş; borçla netleşmiştir.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."debt_cents" IS 'Kalan borç, kuruş.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."refund_due_date" IS 'İadenin son günü: ayrılıştan bir ay sonra.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."approved_by_user_id" IS 'Ayrılışı onaylayan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."refund_paid_date" IS 'İadenin ödendiği gün; ödenen iade değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."refund_iban" IS 'İade IBAN''ı; yanıtlarda yalnız son dört hane döner.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."refund_account_holder" IS 'Hesap sahibi; sözleşmedeki ödeyici olmalıdır.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."refund_paid_by_user_id" IS 'İadeyi ödenmiş işaretleyen yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."created_at" IS 'Satırın oluşturulma anı.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."updated_at" IS 'Satırın son değişme anı.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."archived_at" IS 'Arşiv anı; ortak kolondur.';--> statement-breakpoint
COMMENT ON COLUMN "student_withdrawals"."version" IS 'İyimser kilit sürümü (If-Match).';
