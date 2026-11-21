CREATE TABLE "transport_trip_mark_corrections" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"mark_id" uuid NOT NULL,
	"previous_status" text NOT NULL,
	"previous_boarded_at" timestamp with time zone,
	"previous_alighted_at" timestamp with time zone,
	"status" text NOT NULL,
	"boarded_at" timestamp with time zone,
	"alighted_at" timestamp with time zone,
	"reason" text NOT NULL,
	"corrected_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transport_trip_mark_corrections_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "transport_trip_mark_corrections_status_check" CHECK ("transport_trip_mark_corrections"."status" in ('boarded', 'alighted', 'absent') and "transport_trip_mark_corrections"."previous_status" in ('boarded', 'alighted', 'absent')),
	CONSTRAINT "transport_trip_mark_corrections_reason_check" CHECK (char_length("transport_trip_mark_corrections"."reason") between 5 and 500)
);
--> statement-breakpoint
CREATE TABLE "transport_trip_marks" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"status" text NOT NULL,
	"boarded_at" timestamp with time zone,
	"alighted_at" timestamp with time zone,
	"marked_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transport_trip_marks_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "transport_trip_marks_status_check" CHECK ("transport_trip_marks"."status" in ('boarded', 'alighted', 'absent')),
	CONSTRAINT "transport_trip_marks_times_check" CHECK (("transport_trip_marks"."status" = 'absent' and "transport_trip_marks"."boarded_at" is null and "transport_trip_marks"."alighted_at" is null) or ("transport_trip_marks"."status" = 'boarded' and "transport_trip_marks"."boarded_at" is not null and "transport_trip_marks"."alighted_at" is null) or ("transport_trip_marks"."status" = 'alighted' and "transport_trip_marks"."boarded_at" is not null and "transport_trip_marks"."alighted_at" >= "transport_trip_marks"."boarded_at"))
);
--> statement-breakpoint
CREATE TABLE "transport_trips" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"trip_date" date NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"started_by_user_id" text NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transport_trips_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "transport_trips_route_key" UNIQUE("institution_id","id","route_id"),
	CONSTRAINT "transport_trips_direction_check" CHECK ("transport_trips"."direction" in ('morning', 'evening')),
	CONSTRAINT "transport_trips_status_check" CHECK ("transport_trips"."status" in ('open', 'closed')),
	CONSTRAINT "transport_trips_closed_check" CHECK (("transport_trips"."status" = 'closed') = ("transport_trips"."closed_at" is not null) and ("transport_trips"."closed_at" is null) = ("transport_trips"."closed_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "transport_trip_mark_corrections" ADD CONSTRAINT "transport_trip_mark_corrections_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_trip_mark_corrections" ADD CONSTRAINT "transport_trip_mark_corrections_mark_fkey" FOREIGN KEY ("institution_id","mark_id") REFERENCES "public"."transport_trip_marks"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_trip_marks" ADD CONSTRAINT "transport_trip_marks_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_trip_marks" ADD CONSTRAINT "transport_trip_marks_trip_fkey" FOREIGN KEY ("institution_id","trip_id","route_id") REFERENCES "public"."transport_trips"("institution_id","id","route_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_trip_marks" ADD CONSTRAINT "transport_trip_marks_stop_fkey" FOREIGN KEY ("institution_id","route_id","stop_id") REFERENCES "public"."transport_stops"("institution_id","route_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_route_fkey" FOREIGN KEY ("institution_id","route_id","direction") REFERENCES "public"."transport_routes"("institution_id","id","direction") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_vehicle_fkey" FOREIGN KEY ("institution_id","vehicle_id") REFERENCES "public"."transport_vehicles"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transport_trip_mark_corrections_mark_idx" ON "transport_trip_mark_corrections" USING btree ("institution_id","mark_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_trip_marks_student_key" ON "transport_trip_marks" USING btree ("institution_id","trip_id","student_id") WHERE "transport_trip_marks"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "transport_trip_marks_trip_idx" ON "transport_trip_marks" USING btree ("institution_id","trip_id","route_id");--> statement-breakpoint
CREATE INDEX "transport_trip_marks_stop_idx" ON "transport_trip_marks" USING btree ("institution_id","route_id","stop_id");--> statement-breakpoint
CREATE INDEX "transport_trip_marks_student_idx" ON "transport_trip_marks" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_trips_route_day_key" ON "transport_trips" USING btree ("institution_id","route_id","trip_date","direction") WHERE "transport_trips"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "transport_trips_day_idx" ON "transport_trips" USING btree ("institution_id","trip_date");--> statement-breakpoint
CREATE INDEX "transport_trips_vehicle_idx" ON "transport_trips" USING btree ("institution_id","vehicle_id");--> statement-breakpoint
COMMENT ON TABLE "transport_trips" IS 'Servis seferi (DOM-FIN-149, ON-145, K-502): güzergâh × gün (Europe/Istanbul) × yön; aynı güzergâhın aynı gün ve yönde tek seferi olur. Rehber personel ya da yönetici başlatır ve kapatır; araçta ya da işaretsiz öğrenci varken kapanmaz (K-504). Konum tutulmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."id" IS 'Sefer kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."route_id" IS 'Seferin güzergâhı (transport_routes); yönle birlikte bileşik yabancı anahtar.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."direction" IS 'Yön: morning (sabah, evden okula) ya da evening (akşam, okuldan eve); güzergâhın yönüdür.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."vehicle_id" IS 'Başlatma anında güzergâhın aracı (transport_vehicles); güzergâhın aracı sonra değişse de kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."trip_date" IS 'Seferin günü (Europe/Istanbul); başlatma anının İstanbul günü.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."status" IS 'Durum: open (sürüyor) ya da closed (kapandı); kapanan sefer yeniden açılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."started_at" IS 'Başlatma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."started_by_user_id" IS 'Seferi başlatan kullanıcı (rehber personel ya da yönetici).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."closed_at" IS 'Kapanış anı (UTC); yalnız kapanan seferde dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."closed_by_user_id" IS 'Seferi kapatan kullanıcı; yalnız kapanan seferde dolu.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."archived_at" IS 'Arşiv anı; dolu satır okunmaz (bugün arşivleyen uç yok, saklama süresi H-108).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trips"."version" IS 'İyimser kilit sürümü; her yazmada 1 artar.';
--> statement-breakpoint
COMMENT ON TABLE "transport_trip_marks" IS 'Öğrencinin seferdeki biniş-iniş işareti (DOM-FIN-149, K-502, K-503): bindi, indi ya da gelmedi; seferde öğrenci başına tek satır. Yalnız güzergâha atanmış öğrenci işaretlenir; kapanmış seferde değişiklik yönetici düzeltmesidir. Konum ve biyometri tutulmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."id" IS 'İşaret kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."trip_id" IS 'Sefer (transport_trips).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."route_id" IS 'Seferin güzergâhı; durak ve sefer bağının güzergâh tutarlılığı için.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."stop_id" IS 'İşaret anında öğrencinin atandığı durak (transport_stops); seferin güzergâhında olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."student_id" IS 'Öğrenci (records students kimliği).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."status" IS 'İşaret: boarded (bindi, inişi bekleniyor), alighted (indi) ya da absent (gelmedi).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."boarded_at" IS 'Biniş anı (UTC); bindi ve indi işaretinde dolu, seferin gününde.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."alighted_at" IS 'İniş anı (UTC); yalnız indi işaretinde dolu, binişten önce olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."marked_by_user_id" IS 'İşareti son değiştiren kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."archived_at" IS 'Arşiv anı; dolu satır okunmaz (bugün arşivleyen uç yok, saklama süresi H-108).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_marks"."version" IS 'İyimser kilit sürümü; her yazmada 1 artar.';
--> statement-breakpoint
COMMENT ON TABLE "transport_trip_mark_corrections" IS 'Kapanmış seferin yönetici düzeltmesi (DOM-FIN-149, K-503): önceki ve yeni işaret ile gerekçe. Yalnız eklenir; denetim kaydı alan adlarını, bu tablo gerekçeyi tutar.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."id" IS 'Düzeltme kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."mark_id" IS 'Düzeltilen işaret (transport_trip_marks).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."previous_status" IS 'Düzeltmeden önceki işaret.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."previous_boarded_at" IS 'Düzeltmeden önceki biniş anı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."previous_alighted_at" IS 'Düzeltmeden önceki iniş anı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."status" IS 'Düzeltilmiş işaret; kapanmış seferde boarded olamaz (servis kuralı).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."boarded_at" IS 'Düzeltilmiş biniş anı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."alighted_at" IS 'Düzeltilmiş iniş anı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."reason" IS 'Yöneticinin gerekçesi (5–500 karakter); serbest metin, loga ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."corrected_by_user_id" IS 'Düzelten yönetici.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."archived_at" IS 'Arşiv anı; dolu satır okunmaz (bugün arşivleyen uç yok, saklama süresi H-108).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_trip_mark_corrections"."version" IS 'İyimser kilit sürümü; her yazmada 1 artar.';
