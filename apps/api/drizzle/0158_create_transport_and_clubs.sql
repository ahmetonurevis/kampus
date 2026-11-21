CREATE TABLE "school_club_attendance" (
	"institution_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "school_club_attendance_pkey" PRIMARY KEY("institution_id","session_id","member_id"),
	CONSTRAINT "school_club_attendance_status_check" CHECK ("school_club_attendance"."status" in ('present', 'absent', 'excused'))
);
--> statement-breakpoint
CREATE TABLE "school_club_members" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"joined_by_user_id" text NOT NULL,
	"removed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "school_club_members_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "school_club_members_club_key" UNIQUE("institution_id","club_id","id"),
	CONSTRAINT "school_club_members_removed_check" CHECK (("school_club_members"."archived_at" is null) = ("school_club_members"."removed_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "school_club_sessions" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "school_club_sessions_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "school_club_sessions_club_key" UNIQUE("institution_id","club_id","id")
);
--> statement-breakpoint
CREATE TABLE "school_clubs" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"teacher_membership_id" text NOT NULL,
	"capacity" integer NOT NULL,
	"meeting_day" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "school_clubs_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "school_clubs_name_check" CHECK (char_length("school_clubs"."name") between 2 and 120),
	CONSTRAINT "school_clubs_capacity_check" CHECK ("school_clubs"."capacity" between 1 and 200),
	CONSTRAINT "school_clubs_meeting_day_check" CHECK ("school_clubs"."meeting_day" between 1 and 7),
	CONSTRAINT "school_clubs_time_check" CHECK ("school_clubs"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "school_clubs"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and "school_clubs"."end_time" > "school_clubs"."start_time")
);
--> statement-breakpoint
CREATE TABLE "transport_assignments" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"student_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"removed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transport_assignments_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "transport_assignments_direction_check" CHECK ("transport_assignments"."direction" in ('morning', 'evening')),
	CONSTRAINT "transport_assignments_removed_check" CHECK (("transport_assignments"."archived_at" is null) = ("transport_assignments"."removed_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "transport_routes" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"direction" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transport_routes_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "transport_routes_direction_key" UNIQUE("institution_id","id","direction"),
	CONSTRAINT "transport_routes_direction_check" CHECK ("transport_routes"."direction" in ('morning', 'evening')),
	CONSTRAINT "transport_routes_name_check" CHECK (char_length("transport_routes"."name") between 2 and 120)
);
--> statement-breakpoint
CREATE TABLE "transport_stops" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"stop_time" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transport_stops_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "transport_stops_route_key" UNIQUE("institution_id","route_id","id"),
	CONSTRAINT "transport_stops_position_check" CHECK ("transport_stops"."position" between 1 and 40),
	CONSTRAINT "transport_stops_name_check" CHECK (char_length("transport_stops"."name") between 2 and 80),
	CONSTRAINT "transport_stops_time_check" CHECK ("transport_stops"."stop_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "transport_vehicles" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"plate" text NOT NULL,
	"capacity" integer NOT NULL,
	"driver_name" text NOT NULL,
	"driver_phone" text NOT NULL,
	"guide_membership_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transport_vehicles_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "transport_vehicles_plate_check" CHECK ("transport_vehicles"."plate" ~ '^(0[1-9]|[1-7][0-9]|8[01])[A-Z]{1,3}[0-9]{2,5}$'),
	CONSTRAINT "transport_vehicles_capacity_check" CHECK ("transport_vehicles"."capacity" between 1 and 80),
	CONSTRAINT "transport_vehicles_driver_name_check" CHECK (char_length("transport_vehicles"."driver_name") between 2 and 120),
	CONSTRAINT "transport_vehicles_driver_phone_check" CHECK ("transport_vehicles"."driver_phone" ~ '^0[0-9]{10}$')
);
--> statement-breakpoint
ALTER TABLE "school_club_attendance" ADD CONSTRAINT "school_club_attendance_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_club_attendance" ADD CONSTRAINT "school_club_attendance_session_fkey" FOREIGN KEY ("institution_id","club_id","session_id") REFERENCES "public"."school_club_sessions"("institution_id","club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_club_attendance" ADD CONSTRAINT "school_club_attendance_member_fkey" FOREIGN KEY ("institution_id","club_id","member_id") REFERENCES "public"."school_club_members"("institution_id","club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_club_members" ADD CONSTRAINT "school_club_members_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_club_members" ADD CONSTRAINT "school_club_members_club_fkey" FOREIGN KEY ("institution_id","club_id") REFERENCES "public"."school_clubs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_club_sessions" ADD CONSTRAINT "school_club_sessions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_club_sessions" ADD CONSTRAINT "school_club_sessions_club_fkey" FOREIGN KEY ("institution_id","club_id") REFERENCES "public"."school_clubs"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_clubs" ADD CONSTRAINT "school_clubs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_clubs" ADD CONSTRAINT "school_clubs_teacher_fkey" FOREIGN KEY ("institution_id","teacher_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_route_fkey" FOREIGN KEY ("institution_id","route_id","direction") REFERENCES "public"."transport_routes"("institution_id","id","direction") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_stop_fkey" FOREIGN KEY ("institution_id","route_id","stop_id") REFERENCES "public"."transport_stops"("institution_id","route_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_vehicle_fkey" FOREIGN KEY ("institution_id","vehicle_id") REFERENCES "public"."transport_vehicles"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_stops" ADD CONSTRAINT "transport_stops_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_stops" ADD CONSTRAINT "transport_stops_route_fkey" FOREIGN KEY ("institution_id","route_id") REFERENCES "public"."transport_routes"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_vehicles" ADD CONSTRAINT "transport_vehicles_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_vehicles" ADD CONSTRAINT "transport_vehicles_guide_fkey" FOREIGN KEY ("institution_id","guide_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_club_attendance_session_idx" ON "school_club_attendance" USING btree ("institution_id","club_id","session_id");--> statement-breakpoint
CREATE INDEX "school_club_attendance_member_idx" ON "school_club_attendance" USING btree ("institution_id","club_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_club_members_student_key" ON "school_club_members" USING btree ("institution_id","club_id","student_id") WHERE "school_club_members"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "school_club_members_student_idx" ON "school_club_members" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_club_sessions_date_key" ON "school_club_sessions" USING btree ("institution_id","club_id","session_date") WHERE "school_club_sessions"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "school_clubs_name_key" ON "school_clubs" USING btree ("institution_id","name") WHERE "school_clubs"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "school_clubs_teacher_idx" ON "school_clubs" USING btree ("institution_id","teacher_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_assignments_student_key" ON "transport_assignments" USING btree ("institution_id","student_id","direction") WHERE "transport_assignments"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "transport_assignments_route_idx" ON "transport_assignments" USING btree ("institution_id","route_id","direction");--> statement-breakpoint
CREATE INDEX "transport_assignments_stop_idx" ON "transport_assignments" USING btree ("institution_id","route_id","stop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_routes_name_key" ON "transport_routes" USING btree ("institution_id","direction","name") WHERE "transport_routes"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "transport_routes_vehicle_idx" ON "transport_routes" USING btree ("institution_id","vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_vehicles_plate_key" ON "transport_vehicles" USING btree ("institution_id","plate") WHERE "transport_vehicles"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "transport_vehicles_guide_idx" ON "transport_vehicles" USING btree ("institution_id","guide_membership_id");--> statement-breakpoint
COMMENT ON TABLE "transport_vehicles" IS 'Servis aracı (DOM-FIN-142, ON-098, K-481): plaka, kapasite, sürücü adı ve telefonu, isteğe bağlı rehber personel. Sürücü telefonu yalnız yazılır, yanıtlarda maskeli döner. Etkin güzergâhta kullanılan araç arşivlenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."id" IS 'Araç kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."plate" IS 'Plaka; boşluksuz büyük harf (34ABC123), kurumda arşivlenmemiş araçlar arasında tekil (transport_vehicles_plate_key).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."capacity" IS 'Öğrenci koltuk sayısı (1–80); güzergâh başına etkin atama bu sayıyı aşamaz, atanmış sayının altına inemez.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."driver_name" IS 'Sürücünün adı soyadı (2–120; kişisel veri).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."driver_phone" IS 'Sürücü telefonu (0XXXXXXXXXX; kişisel veri). Yalnız yazılır; her yanıtta maskeli döner, loga ve denetime yazılmaz (K-481, H-105).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."guide_membership_id" IS 'Rehber personelin kurum üyeliği (isteğe bağlı; memberships FK, etkin personel olmalı). Personel tablosu açılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."created_by_user_id" IS 'Aracı kaydeden kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."archived_at" IS 'Arşiv anı; doluysa araç kullanılmaz ve plakası serbest kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_vehicles"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "transport_routes" IS 'Servis güzergâhı (DOM-FIN-142, K-481): ad, yön (sabah/akşam) ve araç. Ad aynı yönde tekil; yön sonradan değişmez. Atanmış öğrencisi olan güzergâh arşivlenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_routes"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_routes"."id" IS 'Güzergâh kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_routes"."name" IS 'Güzergâh adı (2–120); aynı yönde arşivlenmemiş güzergâhlar arasında tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_routes"."direction" IS 'Yön: morning sabah (evden okula), evening akşam (okuldan eve). Atamalar yönü bileşik yabancı anahtarla taşır.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_routes"."vehicle_id" IS 'Güzergâhın aracı (transport_vehicles FK); kapasitesi güzergâhtaki atanmış öğrenci sayısından az olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_routes"."created_by_user_id" IS 'Güzergâhı açan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_routes"."archived_at" IS 'Arşiv anı; doluysa güzergâh listelenmez.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_routes"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_routes"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_routes"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "transport_stops" IS 'Güzergâh durağı (DOM-FIN-142, K-481): sıra, durak adı ya da semt ve geçiş saati. Açık adres tutulmaz (KVKK en az veri; H-105). Listeden çıkan durak arşivlenir; atanmış öğrencisi olan durak çıkarılamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_stops"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_stops"."id" IS 'Durak kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_stops"."route_id" IS 'Durağın güzergâhı (transport_routes FK).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_stops"."position" IS 'Güzergâhtaki sıra (1–40); etkin duraklarda 1den kesintisiz, servis kuralıyla yazılır.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_stops"."name" IS 'Durak adı ya da semt (2–80); güzergâhta tekil. Ev adresi yazılmaz.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_stops"."stop_time" IS 'Duraktan geçiş saati (SS:DD, Europe/Istanbul duvar saati); sırayla ilerler.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_stops"."archived_at" IS 'Durak listeden çıkarıldıysa arşiv anı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_stops"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_stops"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_stops"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "transport_assignments" IS 'Öğrenci–durak ataması (DOM-FIN-142, K-482): öğrenci aynı yönde tek etkin atamaya sahiptir (transport_assignments_student_key); araç kapasitesi kurum kilidi altında servis denetimiyle korunur. Veli ve öğrenci yalnız kendi atamasını okur.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."id" IS 'Atama kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."route_id" IS 'Güzergâh; yönle birlikte transport_routes FK (kurum, kimlik, yön).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."stop_id" IS 'Durak; güzergâhla birlikte transport_stops FK (durak bu güzergâhta olmalı).';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."direction" IS 'Güzergâhın yönü (kopya); öğrenci başına yön tekilliği için tutulur, güzergâhla bileşik yabancı anahtarla tutarlıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."student_id" IS 'Öğrencinin records kimliği (kişisel veri); kurumun etkin öğrencisi olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."created_by_user_id" IS 'Atamayı yapan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."removed_by_user_id" IS 'Atamayı kaldıran kullanıcı; arşivle birlikte dolar.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."archived_at" IS 'Atama kaldırıldıysa arşiv anı; öğrenci yeniden atanabilir.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "transport_assignments"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "school_clubs" IS 'Kulüp (DOM-FIN-142, ON-098, K-483): ad, sorumlu öğretmen, kontenjan ve haftalık gün/saat. Ad kurumda tekil; etkin üyesi olan kulüp arşivlenmez. Okul yaşamının records tabanlı clubs koleksiyonundan ayrıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."id" IS 'Kulüp kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."name" IS 'Kulüp adı (2–120); arşivlenmemiş kulüpler arasında tekil.';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."teacher_membership_id" IS 'Sorumlu öğretmenin kurum üyeliği (memberships FK; etkin öğretmen). Öğretmen yalnız bu kulübü okur ve yoklamasını alır.';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."capacity" IS 'Üye kontenjanı (1–200); etkin üye sayısı aşamaz, düzenlemede altına inemez.';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."meeting_day" IS 'Haftanın günü: 1 Pazartesi … 7 Pazar.';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."start_time" IS 'Başlangıç saati (SS:DD, Europe/Istanbul).';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."end_time" IS 'Bitiş saati (SS:DD); başlangıçtan sonra.';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."created_by_user_id" IS 'Kulübü açan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."archived_at" IS 'Arşiv anı; adı serbest kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "school_clubs"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "school_club_members" IS 'Kulüp üyeliği (DOM-FIN-142, K-483): öğrenci kulüpte tek etkin üyeliğe sahiptir (school_club_members_student_key); kontenjan kurum kilidi altında korunur. Ayrılış arşivdir.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_members"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_members"."id" IS 'Üyelik kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_members"."club_id" IS 'Kulüp (school_clubs FK).';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_members"."student_id" IS 'Öğrencinin records kimliği (kişisel veri); kurumun etkin öğrencisi olmalı.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_members"."joined_by_user_id" IS 'Üyeliği yazan kullanıcı.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_members"."removed_by_user_id" IS 'Üyeliği sonlandıran kullanıcı; arşivle birlikte dolar.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_members"."archived_at" IS 'Üyelik sonlandıysa arşiv anı; geçmiş yoklama işaretleri kalır.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_members"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_members"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_members"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "school_club_sessions" IS 'Kulüp oturumu (DOM-FIN-142, K-483): bir günün yoklaması. Aynı kulüpte aynı günün etkin oturumu tektir (school_club_sessions_date_key); yanlış oturum arşivlenip yeniden alınır.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_sessions"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_sessions"."id" IS 'Oturum kimliği (UUID).';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_sessions"."club_id" IS 'Kulüp (school_clubs FK).';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_sessions"."session_date" IS 'Oturum günü (Europe/Istanbul); bugünden sonra olamaz.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_sessions"."recorded_by_user_id" IS 'Yoklamayı alan kullanıcı (yönetici ya da sorumlu öğretmen).';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_sessions"."archived_at" IS 'Oturum yanlış alındıysa arşiv anı; aynı gün yeniden alınabilir.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_sessions"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_sessions"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_sessions"."version" IS 'İyimser kilit sürümü (If-Match).';
--> statement-breakpoint
COMMENT ON TABLE "school_club_attendance" IS 'Oturum × üye yoklama işareti (DOM-FIN-142, K-483): oturumdaki bütün etkin üyeler bir kez işaretlenir. Oturum ve üyelik aynı kulübe bileşik yabancı anahtarla bağlıdır.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_attendance"."institution_id" IS 'Kurum.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_attendance"."session_id" IS 'Oturum (school_club_sessions FK, kulüple birlikte).';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_attendance"."member_id" IS 'Kulüp üyeliği (school_club_members FK, kulüple birlikte).';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_attendance"."club_id" IS 'Kulüp (kopya); oturum ve üyeliğin aynı kulüpte olmasını yabancı anahtarlarla güvenceler.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_attendance"."status" IS 'Durum: present geldi, absent gelmedi, excused izinli.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_attendance"."archived_at" IS 'Kullanılmıyor (zorunlu kolon); oturum arşivlenince işaretler oturumla birlikte geçersizdir.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_attendance"."created_at" IS 'Satırın oluşturulduğu an.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_attendance"."updated_at" IS 'Son değişiklik anı.';
--> statement-breakpoint
COMMENT ON COLUMN "school_club_attendance"."version" IS 'İyimser kilit sürümü (If-Match).';
