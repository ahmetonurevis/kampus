CREATE TABLE "event_tickets" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"code" text NOT NULL,
	"ticket_type_key" text NOT NULL,
	"ticket_type_name" text NOT NULL,
	"ticket_kind" text NOT NULL,
	"price_cents" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"seat" text,
	"student_id" text NOT NULL,
	"holder_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"payment_status" text NOT NULL,
	"payment_method" text,
	"paid_at" timestamp with time zone,
	"paid_by_user_id" text,
	"refunded_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"used_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "event_tickets_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "event_tickets_kind_check" CHECK ("event_tickets"."ticket_kind" in ('invitation', 'paid')),
	CONSTRAINT "event_tickets_status_check" CHECK ("event_tickets"."status" in ('active', 'cancelled')),
	CONSTRAINT "event_tickets_payment_status_check" CHECK ("event_tickets"."payment_status" in ('not_required', 'unpaid', 'paid')),
	CONSTRAINT "event_tickets_payment_method_check" CHECK ("event_tickets"."payment_method" is null or "event_tickets"."payment_method" in ('cash', 'transfer')),
	CONSTRAINT "event_tickets_currency_check" CHECK ("event_tickets"."currency" = 'TRY'),
	CONSTRAINT "event_tickets_price_check" CHECK (("event_tickets"."ticket_kind" = 'invitation' and "event_tickets"."price_cents" = 0
          and "event_tickets"."payment_status" = 'not_required')
        or ("event_tickets"."ticket_kind" = 'paid' and "event_tickets"."price_cents" > 0
          and "event_tickets"."payment_status" in ('unpaid', 'paid'))),
	CONSTRAINT "event_tickets_paid_check" CHECK (("event_tickets"."payment_status" = 'paid') = ("event_tickets"."paid_at" is not null)
        and ("event_tickets"."paid_at" is null) = ("event_tickets"."payment_method" is null)
        and ("event_tickets"."paid_at" is null) = ("event_tickets"."paid_by_user_id" is null)),
	CONSTRAINT "event_tickets_cancelled_check" CHECK (("event_tickets"."status" = 'cancelled') = ("event_tickets"."cancelled_at" is not null)
        and ("event_tickets"."cancelled_at" is null) = ("event_tickets"."cancelled_by_user_id" is null)
        and ("event_tickets"."cancel_reason" is null or "event_tickets"."cancelled_at" is not null)
        and ("event_tickets"."refunded_at" is null or ("event_tickets"."cancelled_at" is not null
          and "event_tickets"."payment_status" = 'paid'))),
	CONSTRAINT "event_tickets_used_check" CHECK (("event_tickets"."used_at" is null) = ("event_tickets"."used_by_user_id" is null)
        and ("event_tickets"."used_at" is null or "event_tickets"."status" = 'active'))
);--> statement-breakpoint
CREATE TABLE "ticketed_events" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"venue" text NOT NULL,
	"school_event_id" text,
	"seating_mode" text NOT NULL,
	"row_count" integer,
	"seats_per_row" integer,
	"blocked_seats" text[] DEFAULT '{}'::text[] NOT NULL,
	"capacity" integer,
	"ticket_types" jsonb NOT NULL,
	"per_student_limit" integer,
	"sales_open" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ticketed_events_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "ticketed_events_seating_mode_check" CHECK ("ticketed_events"."seating_mode" in ('seated', 'general')),
	CONSTRAINT "ticketed_events_layout_check" CHECK (("ticketed_events"."seating_mode" = 'seated'
          and "ticketed_events"."row_count" between 1 and 26
          and "ticketed_events"."seats_per_row" between 1 and 60
          and "ticketed_events"."capacity" is null)
        or ("ticketed_events"."seating_mode" = 'general'
          and "ticketed_events"."capacity" between 1 and 5000
          and "ticketed_events"."row_count" is null and "ticketed_events"."seats_per_row" is null
          and cardinality("ticketed_events"."blocked_seats") = 0)),
	CONSTRAINT "ticketed_events_ticket_types_check" CHECK (jsonb_typeof("ticketed_events"."ticket_types") = 'array'
        and jsonb_array_length("ticketed_events"."ticket_types") between 1 and 5),
	CONSTRAINT "ticketed_events_per_student_limit_check" CHECK ("ticketed_events"."per_student_limit" is null
        or "ticketed_events"."per_student_limit" between 1 and 20)
);--> statement-breakpoint
ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_event_fkey" FOREIGN KEY ("institution_id","event_id") REFERENCES "public"."ticketed_events"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketed_events" ADD CONSTRAINT "ticketed_events_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_tickets_code_key" ON "event_tickets" USING btree ("institution_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "event_tickets_event_seat_key" ON "event_tickets" USING btree ("institution_id","event_id","seat") WHERE "event_tickets"."status" = 'active' and "event_tickets"."seat" is not null;--> statement-breakpoint
CREATE INDEX "event_tickets_event_idx" ON "event_tickets" USING btree ("institution_id","event_id");--> statement-breakpoint
CREATE INDEX "event_tickets_student_idx" ON "event_tickets" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE INDEX "ticketed_events_starts_at_idx" ON "ticketed_events" USING btree ("institution_id","starts_at");--> statement-breakpoint
COMMENT ON TABLE "ticketed_events" IS 'Biletli etkinlik (DOM-FIN-103, ON-159, K-325): gösteri ve tören gibi bilet ve oturma düzeni gerektiren etkinlik. Oturma düzeni numaralı salon (sıra harfi × koltuk, kapalı koltuklar) ya da numarasız kontenjandır. Bilet türleri ücretsiz davetiye ya da ücretli (kuruş) olur; öğrenci başına etkin bilet üst sınırı konabilir. Etkinliği yalnız yönetici açar ve düzeltir; etkin bileti varken arşivlenmez.';--> statement-breakpoint
COMMENT ON TABLE "event_tickets" IS 'Etkinlik bileti (DOM-FIN-103, K-325…K-327): öğrencinin ailesine ayrılan ve bilet sahibinin (veli ya da misafir) adını taşıyan bilet. Tür adı, türü ve fiyatı ayırma anında kopyalanır. Numaralı salonda koltuk etkin biletler arasında tekildir (event_tickets_event_seat_key); iptal koltuğu boşa çıkarır. Ücretli biletin ödemesi elle (nakit ya da havale) işaretlenir; çevrim içi ödeme yoktur. Kod tahmin edilemez, girişte bir kez kullanıldı işaretlenir. Bilet silinmez.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."version" IS 'İyimser kilit sürümü; her güncellemede bir artar (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."id" IS 'Etkinlik kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."archived_at" IS 'Arşiv zamanı; etkin bileti olmayan etkinlik silinmez, arşivlenir.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."name" IS 'Etkinlik adı (2–120 karakter).';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."starts_at" IS 'Başlangıç anı (UTC); gösterim Europe/Istanbul. Açılışta ve değişince gelecekte olmalıdır.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."venue" IS 'Salon ya da yer adı (2–120 karakter).';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."school_event_id" IS 'İsteğe bağlı okul takvimi etkinliği (records schoolEvents kimliği; yabancı anahtar değil, yazarken kurumda varlığı denetlenir).';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."seating_mode" IS 'Oturma düzeni: seated numaralı koltuk, general numarasız kontenjan. Etkin bilet varken değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."row_count" IS 'Numaralı salonda sıra sayısı (1–26, A’dan başlar); numarasızda boş.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."seats_per_row" IS 'Numaralı salonda sıra başına koltuk (1–60); numarasızda boş.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."blocked_seats" IS 'Satışa kapalı koltuk etiketleri (ör. A1); etkin biletli koltuk kapatılamaz. Numarasızda boş dizi.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."capacity" IS 'Numarasız etkinlikte kişi kontenjanı (1–5000); etkin bilet sayısının altına inmez. Numaralı salonda boş (kontenjan koltuklardan hesaplanır).';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."ticket_types" IS 'Bilet türleri: [{key, name, kind, priceCents}] dizisi, 1–5 tür. kind invitation (fiyat 0) ya da paid (fiyat > 0, kuruş). Bileti olan tür kaldırılamaz.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."per_student_limit" IS 'Öğrenci (aile) başına etkin bilet üst sınırı (1–20); boşsa sınırsız. Yalnız sonraki ayırmalara uygulanır.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."sales_open" IS 'Bilet ayırma açık mı; kapalıyken yeni bilet ayrılmaz, ödeme, iptal ve giriş sürer.';--> statement-breakpoint
COMMENT ON COLUMN "ticketed_events"."created_by_user_id" IS 'Etkinliği açan yönetici.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."institution_id" IS 'Kurum.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."created_at" IS 'Oluşturma zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."updated_at" IS 'Son değişiklik zamanı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."version" IS 'İyimser kilit sürümü; her güncellemede bir artar (If-Match).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."id" IS 'Bilet kimliği.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."archived_at" IS 'Kullanılmaz; bilet silinmez ve arşivlenmez, iptal edilir (status).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."event_id" IS 'Etkinlik (ticketed_events).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."code" IS 'Bilet kodu XXXX-XXXX-XXXX (Crockford base32, 60 bit kriptografik rastgele); kurumda tekil. Girişte bilet yerine geçer; CSV’ye ve loga yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."ticket_type_key" IS 'Etkinlikteki bilet türü anahtarı (ticket_types[].key).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."ticket_type_name" IS 'Ayırma anındaki bilet türü adı (kopya).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."ticket_kind" IS 'Ayırma anındaki tür: invitation ücretsiz davetiye, paid ücretli.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."price_cents" IS 'Ayırma anındaki fiyat, kuruş; davetiyede 0. Tür fiyatı sonradan değişse de değişmez.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."currency" IS 'Para birimi; yalnız TRY.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."seat" IS 'Numaralı salonda koltuk etiketi (ör. B12); numarasızda boş. Etkinlikte etkin biletler arasında tekildir.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."student_id" IS 'Biletin ayrıldığı öğrencinin records kimliği; üst sınır öğrenci başına sayılır.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."holder_name" IS 'Bileti kullanacak veli ya da misafirin adı (kişisel veri; loga yazılmaz).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."status" IS 'Durum: active etkin, cancelled iptal. İptal koltuğu boşa çıkarır, geri alınmaz.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."payment_status" IS 'Ödeme: not_required davetiye, unpaid ödenmedi, paid ödendi. Ödenmemiş ücretli bilet girişte kullanılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."payment_method" IS 'Elle işaretlenen ödeme yöntemi: cash nakit, transfer havale/EFT. Gün sonuna girmez (K-326, M-49).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."paid_at" IS 'Ödemenin işaretlendiği an (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."paid_by_user_id" IS 'Ödemeyi işaretleyen personel.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."refunded_at" IS 'Ödenmiş biletin iptalinde bedelin elle iade edildiği an; kısmi iade yok.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."used_at" IS 'Girişte kullanıldı işaretinin anı; bilet bir kez kullanılır, kullanılmış bilet iptal edilmez.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."used_by_user_id" IS 'Girişi işaretleyen personel.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."cancelled_at" IS 'İptal anı (UTC).';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."cancelled_by_user_id" IS 'Bileti iptal eden personel.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."cancel_reason" IS 'İsteğe bağlı iptal notu (≤ 200); denetim kaydına yazılmaz.';--> statement-breakpoint
COMMENT ON COLUMN "event_tickets"."created_by_user_id" IS 'Bileti ayıran personel.';