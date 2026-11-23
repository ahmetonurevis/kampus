CREATE TABLE "staff_change_requests" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"membership_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"iban_ciphertext" text,
	"iban_key_version" integer,
	"file_id" uuid,
	"staff_document_id" uuid,
	"requested_by_user_id" text NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_change_requests_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "staff_change_requests_kind_check" CHECK ("staff_change_requests"."kind" in ('contact', 'emergency_contacts', 'bank', 'document')),
	CONSTRAINT "staff_change_requests_status_check" CHECK ("staff_change_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "staff_change_requests_payload_check" CHECK (jsonb_typeof("staff_change_requests"."payload") = 'object' and "staff_change_requests"."payload"->>'kind' = "staff_change_requests"."kind"),
	CONSTRAINT "staff_change_requests_iban_check" CHECK (("staff_change_requests"."iban_ciphertext" is null) = ("staff_change_requests"."iban_key_version" is null)
        and ("staff_change_requests"."iban_ciphertext" is not null) = ("staff_change_requests"."kind" = 'bank')
        and ("staff_change_requests"."iban_key_version" is null or "staff_change_requests"."iban_key_version" > 0)),
	CONSTRAINT "staff_change_requests_document_check" CHECK (("staff_change_requests"."kind" = 'document' or ("staff_change_requests"."file_id" is null and "staff_change_requests"."staff_document_id" is null))
        and ("staff_change_requests"."staff_document_id" is null or "staff_change_requests"."status" = 'approved')),
	CONSTRAINT "staff_change_requests_decision_check" CHECK (("staff_change_requests"."decided_at" is null) = ("staff_change_requests"."decided_by_user_id" is null)
        and ("staff_change_requests"."decided_at" is not null) = ("staff_change_requests"."status" in ('approved', 'rejected'))
        and ("staff_change_requests"."rejection_reason" is not null) = ("staff_change_requests"."status" = 'rejected')
        and ("staff_change_requests"."rejection_reason" is null or char_length("staff_change_requests"."rejection_reason")
          between 5 and 500))
);
--> statement-breakpoint
ALTER TABLE "staff_change_requests" ADD CONSTRAINT "staff_change_requests_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_change_requests" ADD CONSTRAINT "staff_change_requests_membership_fkey" FOREIGN KEY ("institution_id","membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_change_requests" ADD CONSTRAINT "staff_change_requests_file_fkey" FOREIGN KEY ("institution_id","file_id") REFERENCES "public"."files"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_change_requests" ADD CONSTRAINT "staff_change_requests_document_fkey" FOREIGN KEY ("institution_id","staff_document_id") REFERENCES "public"."staff_documents"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_change_requests_member_idx" ON "staff_change_requests" USING btree ("institution_id","membership_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_change_requests_status_idx" ON "staff_change_requests" USING btree ("institution_id","status","created_at");--> statement-breakpoint
CREATE INDEX "staff_change_requests_file_idx" ON "staff_change_requests" USING btree ("institution_id","file_id");--> statement-breakpoint
CREATE INDEX "staff_change_requests_document_idx" ON "staff_change_requests" USING btree ("institution_id","staff_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_change_requests_pending_key" ON "staff_change_requests" USING btree ("institution_id","membership_id","kind") WHERE "staff_change_requests"."status" = 'pending' and "staff_change_requests"."kind" <> 'document' and "staff_change_requests"."archived_at" is null;--> statement-breakpoint
COMMENT ON TABLE "staff_change_requests" IS 'Personel self-servisi değişiklik talebi (DOM-FIN-166, ON-189, K-553…K-555): personel kendi özlük kartının (staff_personnel_files) adres/telefon, acil durum kişileri ve banka bilgisi için ya da yeni özlük belgesi (staff_documents) için talep açar. Yönetici onaylar (kart ya da belge aynı transaction''da yazılır) veya gerekçeyle reddeder; personel bekleyen talebini geri çeker. Belge dışındaki türde personel başına tek bekleyen talep olur. Satır silinmez.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."id" IS 'Talep kimliği (UUID); IBAN şifresinin bağlandığı satır anahtarı.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."membership_id" IS 'Talebi açan personelin kurum üyeliği (memberships; yönetici, öğretmen ya da ön büro). Personel tablosu yoktur; talep oturumdaki üyelikten açılır, istekte personel kimliği alınmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."kind" IS 'Talep türü: contact (adres ve telefon), emergency_contacts (acil durum kişileri), bank (IBAN ve hesap sahibi), document (yeni özlük belgesi).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."status" IS 'Durum: pending (onay bekliyor), approved (onaylandı, kayda yazıldı), rejected (gerekçeyle reddedildi), cancelled (personel geri çekti). Yalnız bekleyen talep karar alır ya da geri çekilir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."payload" IS 'Türe göre önerilen değerler (kişisel veri): adres/telefon, acil durum kişileri listesi, hesap sahibi, belge türü, rapor türü, belge günü ve not. Okumada school-core şemasından geçer; kind alanı kolondaki türle aynıdır. IBAN burada tutulmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."iban_ciphertext" IS 'Banka talebinde önerilen IBAN, AES-256-GCM ile şifreli (kurum, tablo, kolon ve talep kimliğine bağlı); düz metin yok. Okumada her zaman maskeli döner; onayda çözülüp özlük kartına kendi bağıyla yeniden şifrelenir.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."iban_key_version" IS 'IBAN şifresinin anahtar sürümü; IBAN ile birlikte bulunur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."file_id" IS 'Belge talebinde personelin yüklediği document amaçlı dosya (files); isteğe bağlı. Bekleyen talepte talebe bağlıdır, onayda özlük belgesine taşınır, ret ve geri çekmede bağı kaldırılır. Sağlık raporu ve adli sicil özel nitelikli olabilir; açılışı denetime yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."staff_document_id" IS 'Onaylanan belge talebinin açtığı özlük belgesi (staff_documents); yalnız onaylı belge talebinde dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."requested_by_user_id" IS 'Talebi açan kullanıcı (personelin kendisi).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."decided_by_user_id" IS 'Onaylayan ya da reddeden yönetici; karar verilmemiş ya da geri çekilmiş talepte boş.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."decided_at" IS 'Karar anı (UTC); karar veren kullanıcıyla birlikte bulunur.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."rejection_reason" IS 'Ret gerekçesi (5–500 karakter, serbest metin); yalnız reddedilen talepte dolu, personele gösterilir, denetim kaydına ve loga yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."created_at" IS 'Talebin açıldığı an (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."archived_at" IS 'Arşiv anı; talep bugün arşivlenmez (geçmiş korunur), kolon zorunlu kolon düzeni için vardır.';
--> statement-breakpoint
COMMENT ON COLUMN "staff_change_requests"."version" IS 'İyimser kilit sürümü; onay, ret ve geri çekme If-Match ile bu sürümü ister.';
