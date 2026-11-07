-- Dil okulu grubu, kursiyerleri ve bekleme sırası (OG-029, IST-077; DOM-DIL-003, -008, -040…043).
-- Tablolar yenidir; kısıtlar `not valid` adımı olmadan tek adımda eklenir. Numara 0029 görev
-- satırında ayrıldı. Grup kura `(institution_id, course_id)` bileşik yabancı anahtarıyla bağlanır;
-- saklanan durum `planned`/`open`/`cancelled`, `running`/`completed` tarihten türetilir. Çakışma,
-- kapasite ve açılış kuralları core `lib/language-groups.ts`'te kurum kilidi altındadır.
-- Elle eklenenler: öğretmen bileşik anahtarı için `memberships (institution_id, id)` tekil indeksi
-- (Better Auth şeması üretir, elle düzenlenmez; 0001'deki indeks gibi) ve üyelik silinince yalnız
-- öğretmen kolonunu boşaltan `on delete set null ("teacher_membership_id")` (Drizzle kolon
-- listesini üretmez; `institution_id` boşalamaz). Kursiyer `records` öğrenci kaydına sabit
-- `student_collection` kolonuyla bağlanır.
CREATE UNIQUE INDEX "memberships_institution_id_id_key" ON "memberships" USING btree ("institution_id","id");--> statement-breakpoint
CREATE TABLE "language_group_members" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"student_collection" text GENERATED ALWAYS AS ('students') STORED NOT NULL,
	"status" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "language_group_members_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "language_group_members_status_check" CHECK ("language_group_members"."status" in ('active', 'frozen'))
);
--> statement-breakpoint
CREATE TABLE "language_group_waitlist" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"group_id" uuid,
	"student_id" text,
	"prospect_id" text,
	"requested_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"offer_group_id" uuid,
	"offered_at" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "language_group_waitlist_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "language_group_waitlist_status_check" CHECK ("language_group_waitlist"."status" in ('waiting', 'offered', 'accepted', 'expired', 'withdrawn')),
	CONSTRAINT "language_group_waitlist_learner_check" CHECK (("language_group_waitlist"."student_id" is null) <> ("language_group_waitlist"."prospect_id" is null)),
	CONSTRAINT "language_group_waitlist_offer_check" CHECK ((("language_group_waitlist"."offer_group_id" is null) = ("language_group_waitlist"."offered_at" is null)
          and ("language_group_waitlist"."offered_at" is null) = ("language_group_waitlist"."offer_expires_at" is null))
        and ("language_group_waitlist"."status" <> 'waiting' or "language_group_waitlist"."offered_at" is null)
        and ("language_group_waitlist"."status" not in ('offered', 'accepted', 'expired') or "language_group_waitlist"."offered_at" is not null)
        and ("language_group_waitlist"."offer_expires_at" is null or "language_group_waitlist"."offer_expires_at" > "language_group_waitlist"."offered_at"))
);
--> statement-breakpoint
CREATE TABLE "language_groups" (
	"institution_id" text NOT NULL,
	"id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"age_band" text NOT NULL,
	"teacher_membership_id" text,
	"delivery" text NOT NULL,
	"room" text,
	"room_key" text,
	"schedule" jsonb NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"capacity" integer NOT NULL,
	"state" text NOT NULL,
	"opened_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"merged_into_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "language_groups_pkey" PRIMARY KEY("institution_id","id"),
	CONSTRAINT "language_groups_name_check" CHECK (char_length("language_groups"."name") between 1 and 120),
	CONSTRAINT "language_groups_age_band_check" CHECK ("language_groups"."age_band" in ('child', 'teen', 'adult')),
	CONSTRAINT "language_groups_delivery_check" CHECK ("language_groups"."delivery" in ('in_person', 'online')),
	CONSTRAINT "language_groups_room_check" CHECK (("language_groups"."room" is null) = ("language_groups"."room_key" is null)
        and ("language_groups"."room" is null or char_length("language_groups"."room") between 1 and 60)
        and ("language_groups"."delivery" = 'in_person' or "language_groups"."room" is null)),
	CONSTRAINT "language_groups_schedule_check" CHECK (jsonb_typeof("language_groups"."schedule") = 'array' and jsonb_array_length("language_groups"."schedule") >= 1),
	CONSTRAINT "language_groups_dates_check" CHECK ("language_groups"."end_date" >= "language_groups"."start_date"),
	CONSTRAINT "language_groups_capacity_check" CHECK ("language_groups"."capacity" between 1 and 18),
	CONSTRAINT "language_groups_state_check" CHECK ("language_groups"."state" in ('planned', 'open', 'cancelled')),
	CONSTRAINT "language_groups_lifecycle_check" CHECK (("language_groups"."state" = 'planned' and "language_groups"."opened_at" is null and "language_groups"."cancelled_at" is null)
        or ("language_groups"."state" = 'open' and "language_groups"."opened_at" is not null and "language_groups"."cancelled_at" is null)
        or ("language_groups"."state" = 'cancelled' and "language_groups"."cancelled_at" is not null
          and "language_groups"."cancel_reason" is not null)),
	CONSTRAINT "language_groups_cancel_check" CHECK (("language_groups"."cancel_reason" is null or char_length("language_groups"."cancel_reason") between 1 and 500)
        and ("language_groups"."merged_into_group_id" is null
          or ("language_groups"."state" = 'cancelled' and "language_groups"."merged_into_group_id" <> "language_groups"."id")))
);
--> statement-breakpoint
ALTER TABLE "language_group_members" ADD CONSTRAINT "language_group_members_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_group_members" ADD CONSTRAINT "language_group_members_group_fkey" FOREIGN KEY ("institution_id","group_id") REFERENCES "public"."language_groups"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_group_members" ADD CONSTRAINT "language_group_members_student_fkey" FOREIGN KEY ("institution_id","student_collection","student_id") REFERENCES "public"."records"("institution_id","collection","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_group_waitlist" ADD CONSTRAINT "language_group_waitlist_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_group_waitlist" ADD CONSTRAINT "language_group_waitlist_course_fkey" FOREIGN KEY ("institution_id","course_id") REFERENCES "public"."courses"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_group_waitlist" ADD CONSTRAINT "language_group_waitlist_group_fkey" FOREIGN KEY ("institution_id","group_id") REFERENCES "public"."language_groups"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_group_waitlist" ADD CONSTRAINT "language_group_waitlist_offer_group_fkey" FOREIGN KEY ("institution_id","offer_group_id") REFERENCES "public"."language_groups"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_groups" ADD CONSTRAINT "language_groups_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_groups" ADD CONSTRAINT "language_groups_course_fkey" FOREIGN KEY ("institution_id","course_id") REFERENCES "public"."courses"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_groups" ADD CONSTRAINT "language_groups_teacher_fkey" FOREIGN KEY ("institution_id","teacher_membership_id") REFERENCES "public"."memberships"("institution_id","id") ON DELETE SET NULL ("teacher_membership_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_groups" ADD CONSTRAINT "language_groups_merged_into_fkey" FOREIGN KEY ("institution_id","merged_into_group_id") REFERENCES "public"."language_groups"("institution_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "language_group_members_group_student_key" ON "language_group_members" USING btree ("institution_id","group_id","student_id") WHERE "language_group_members"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "language_group_members_student_idx" ON "language_group_members" USING btree ("institution_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "language_group_waitlist_student_key" ON "language_group_waitlist" USING btree ("institution_id","course_id","student_id") WHERE "language_group_waitlist"."archived_at" is null and "language_group_waitlist"."student_id" is not null and "language_group_waitlist"."status" in ('waiting', 'offered');--> statement-breakpoint
CREATE UNIQUE INDEX "language_group_waitlist_prospect_key" ON "language_group_waitlist" USING btree ("institution_id","course_id","prospect_id") WHERE "language_group_waitlist"."archived_at" is null and "language_group_waitlist"."prospect_id" is not null and "language_group_waitlist"."status" in ('waiting', 'offered');--> statement-breakpoint
CREATE INDEX "language_group_waitlist_course_idx" ON "language_group_waitlist" USING btree ("institution_id","course_id","requested_at");--> statement-breakpoint
CREATE INDEX "language_group_waitlist_group_idx" ON "language_group_waitlist" USING btree ("institution_id","group_id");--> statement-breakpoint
CREATE INDEX "language_group_waitlist_offer_group_idx" ON "language_group_waitlist" USING btree ("institution_id","offer_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "language_groups_name_key" ON "language_groups" USING btree ("institution_id","name_key") WHERE "language_groups"."archived_at" is null and "language_groups"."state" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "language_groups_course_idx" ON "language_groups" USING btree ("institution_id","course_id");--> statement-breakpoint
CREATE INDEX "language_groups_teacher_idx" ON "language_groups" USING btree ("institution_id","teacher_membership_id");--> statement-breakpoint
CREATE INDEX "language_groups_merged_into_idx" ON "language_groups" USING btree ("institution_id","merged_into_group_id");