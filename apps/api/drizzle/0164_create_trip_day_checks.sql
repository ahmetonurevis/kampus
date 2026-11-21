CREATE TABLE "trip_day_check_marks" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"status" text NOT NULL,
	"marked_at" timestamp with time zone NOT NULL,
	"marked_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_day_check_marks_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "trip_day_check_marks_status_check" CHECK ("trip_day_check_marks"."status" in ('present', 'absent'))
);
--> statement-breakpoint
CREATE TABLE "trip_day_checks" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"checkpoint" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"started_by_user_id" text NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"missing_count" integer,
	"missing_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_day_checks_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "trip_day_checks_status_check" CHECK ("trip_day_checks"."status" in ('open', 'complete', 'incomplete')),
	CONSTRAINT "trip_day_checks_text_check" CHECK ("trip_day_checks"."sequence" >= 1
        and char_length("trip_day_checks"."checkpoint") between 2 and 60
        and ("trip_day_checks"."missing_reason" is null
          or char_length("trip_day_checks"."missing_reason") between 5 and 500)),
	CONSTRAINT "trip_day_checks_closed_check" CHECK (("trip_day_checks"."status" = 'open') = ("trip_day_checks"."closed_at" is null)
        and ("trip_day_checks"."closed_at" is null) = ("trip_day_checks"."closed_by_user_id" is null)
        and ("trip_day_checks"."closed_at" is null) = ("trip_day_checks"."missing_count" is null)
        and ("trip_day_checks"."status" <> 'complete' or "trip_day_checks"."missing_count" = 0)
        and ("trip_day_checks"."status" = 'incomplete') = ("trip_day_checks"."missing_reason" is not null)
        and ("trip_day_checks"."status" <> 'incomplete' or "trip_day_checks"."missing_count" > 0))
);
--> statement-breakpoint
CREATE TABLE "trip_day_groups" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"vehicle_plate" text,
	"leader_membership_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_day_groups_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "trip_day_groups_plan_key" UNIQUE("institution_id","id","plan_id"),
	CONSTRAINT "trip_day_groups_text_check" CHECK (char_length("trip_day_groups"."name") between 2 and 60
        and ("trip_day_groups"."vehicle_plate" is null or "trip_day_groups"."vehicle_plate" ~ '^[0-9]{2}[A-Z]{1,3}[0-9]{2,5}$')),
	CONSTRAINT "trip_day_groups_position_check" CHECK ("trip_day_groups"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trip_day_members" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_day_members_pkey" PRIMARY KEY("institution_id","id")
);
--> statement-breakpoint
ALTER TABLE "trip_day_check_marks" ADD CONSTRAINT "trip_day_check_marks_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_check_marks" ADD CONSTRAINT "trip_day_check_marks_check_fkey" FOREIGN KEY ("institution_id","check_id") REFERENCES "public"."trip_day_checks"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_checks" ADD CONSTRAINT "trip_day_checks_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_checks" ADD CONSTRAINT "trip_day_checks_group_fkey" FOREIGN KEY ("institution_id","group_id","plan_id") REFERENCES "public"."trip_day_groups"("institution_id","id","plan_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_groups" ADD CONSTRAINT "trip_day_groups_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_groups" ADD CONSTRAINT "trip_day_groups_plan_fkey" FOREIGN KEY ("institution_id","plan_id") REFERENCES "public"."trip_plans"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_groups" ADD CONSTRAINT "trip_day_groups_leader_fkey" FOREIGN KEY ("institution_id","leader_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_members" ADD CONSTRAINT "trip_day_members_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_members" ADD CONSTRAINT "trip_day_members_group_fkey" FOREIGN KEY ("institution_id","group_id","plan_id") REFERENCES "public"."trip_day_groups"("institution_id","id","plan_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_day_check_marks_student_key" ON "trip_day_check_marks" USING btree ("institution_id","check_id","student_id") WHERE "trip_day_check_marks"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "trip_day_check_marks_check_idx" ON "trip_day_check_marks" USING btree ("institution_id","check_id");--> statement-breakpoint
CREATE INDEX "trip_day_check_marks_student_idx" ON "trip_day_check_marks" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_day_checks_sequence_key" ON "trip_day_checks" USING btree ("institution_id","group_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_day_checks_open_key" ON "trip_day_checks" USING btree ("institution_id","group_id") WHERE "trip_day_checks"."status" = 'open' and "trip_day_checks"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "trip_day_checks_plan_idx" ON "trip_day_checks" USING btree ("institution_id","plan_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_day_groups_name_key" ON "trip_day_groups" USING btree ("institution_id","plan_id",lower("name")) WHERE "trip_day_groups"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "trip_day_groups_plan_idx" ON "trip_day_groups" USING btree ("institution_id","plan_id","position");--> statement-breakpoint
CREATE INDEX "trip_day_groups_leader_idx" ON "trip_day_groups" USING btree ("institution_id","leader_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_day_members_student_key" ON "trip_day_members" USING btree ("institution_id","plan_id","student_id") WHERE "trip_day_members"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "trip_day_members_group_idx" ON "trip_day_members" USING btree ("institution_id","group_id");--> statement-breakpoint
CREATE INDEX "trip_day_members_student_idx" ON "trip_day_members" USING btree ("institution_id","student_id");--> statement-breakpoint
COMMENT ON TABLE "trip_day_groups" IS 'Gezi günü grubu (DOM-FIN-154, ON-157, K-517): gezi planının (trip_plans, DOM-FIN-111) aracı ya da grubu; isteğe bağlı plaka ve planın görevlisi olan grup sorumlusu. Ad planda büyük/küçük harf duyarsız tekildir. Yönetici ve ön büro kurar; yoklama turu açılmış grup arşivlenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_groups"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_groups"."id" IS 'Grup kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_groups"."plan_id" IS 'Gezi planı (trip_plans).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_groups"."name" IS 'Araç ya da grup adı (2–60 karakter; ör. 1. otobüs).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_groups"."vehicle_plate" IS 'Grubun aracının plakası; boşluksuz büyük harfle (34ABC123), araçsız grupta boş.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_groups"."leader_membership_id" IS 'Grup sorumlusu (memberships); planın etkin görevlisi olmalı (servis kuralı). Tur yürütür ve acil kartı açar.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_groups"."position" IS 'Plandaki sıra (0 tabanlı).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_groups"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_groups"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_groups"."archived_at" IS 'Arşiv anı; dolu satır okunmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_groups"."version" IS 'İyimser kilit sürümü; her yazmada 1 artar.';
--> statement-breakpoint
COMMENT ON TABLE "trip_day_members" IS 'Öğrencinin gezi günündeki grubu (DOM-FIN-154, K-517): planda öğrenci başına tek etkin satır. Yalnız gezinin katılımcısı (bağlı ücretli etkinlikte asil katılım, etkinliksiz planda kayıtlı öğrenci) eklenir; süren turu olan grubun dağıtımı değişmez.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_members"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_members"."id" IS 'Üyelik satırı kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_members"."plan_id" IS 'Gezi planı; grubun planıyla aynı olmalı (bileşik yabancı anahtar).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_members"."group_id" IS 'Öğrencinin grubu (trip_day_groups); taşımada değişir.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_members"."student_id" IS 'Öğrenci (records students kimliği).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_members"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_members"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_members"."archived_at" IS 'Arşiv anı; dolu satır okunmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_members"."version" IS 'İyimser kilit sürümü; her yazmada 1 artar.';
--> statement-breakpoint
COMMENT ON TABLE "trip_day_checks" IS 'Gezi günü yoklama turu (DOM-FIN-154, K-517): grubun adlandırılmış kontrol noktası (okuldan çıkış, varış, dönüş çıkışı, okula varış …), grupta sıra numarasıyla. Grubun tek süren turu olur. Eksik varken tur complete olamaz; herkes işaretliyken gerekçeyle incomplete (eksikle devam) kapanır. Kapanan tur yeniden açılmaz. Konum tutulmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."id" IS 'Tur kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."plan_id" IS 'Gezi planı; grubun planıyla aynı (bileşik yabancı anahtar).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."group_id" IS 'Turun grubu (trip_day_groups).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."sequence" IS 'Grupta tur sırası (1, 2, …); tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."checkpoint" IS 'Kontrol noktası adı (2–60 karakter).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."status" IS 'Durum: open (sürüyor), complete (herkes var) ya da incomplete (gerekçeli eksikle devam).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."started_at" IS 'Turun açılış anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."started_by_user_id" IS 'Turu açan kullanıcı (grup sorumlusu ya da yönetici).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."closed_at" IS 'Kapanış anı (UTC); süren turda boş.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."closed_by_user_id" IS 'Turu kapatan kullanıcı; süren turda boş.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."missing_count" IS 'Kapanışta eksik (yok) öğrenci sayısı; complete turda 0, incomplete turda en az 1, süren turda boş.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."missing_reason" IS 'Eksikle devam gerekçesi (5–500 karakter); yalnız incomplete turda dolu. Serbest metin; loga ve denetime yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."archived_at" IS 'Arşiv anı; dolu satır okunmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_checks"."version" IS 'İyimser kilit sürümü; her yazmada 1 artar.';
--> statement-breakpoint
COMMENT ON TABLE "trip_day_check_marks" IS 'Turda öğrencinin işareti (DOM-FIN-154, K-517): var ya da yok; turda öğrenci başına tek satır. Süren turda değişebilir, kapanan turda donar. Veli çocuğunun son kapanan kontrol noktasındaki işaretini görür (K-519). Konum ve biyometri tutulmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_check_marks"."institution_id" IS 'Kurum; birincil anahtarın ve her indeksin ilk kolonu.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_check_marks"."id" IS 'İşaret kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_check_marks"."check_id" IS 'Yoklama turu (trip_day_checks).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_check_marks"."student_id" IS 'Öğrenci (records students kimliği).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_check_marks"."status" IS 'İşaret: present (var) ya da absent (yok).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_check_marks"."marked_at" IS 'İşaret anı (UTC); çevrimdışı kuyrukta cihazın işaret anı (en çok 5 dk ileri, 24 saat geri).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_check_marks"."marked_by_user_id" IS 'İşareti son değiştiren kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_check_marks"."created_at" IS 'Oluşturulma anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_check_marks"."updated_at" IS 'Son değişiklik anı (UTC).';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_check_marks"."archived_at" IS 'Arşiv anı; dolu satır okunmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_day_check_marks"."version" IS 'İyimser kilit sürümü; her yazmada 1 artar.';
