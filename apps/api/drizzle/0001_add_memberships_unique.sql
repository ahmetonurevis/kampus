-- Better Auth şeması bileşik benzersizlik tanımlayamıyor (CLI üretir, elle düzenlenmez);
-- bir kullanıcının aynı kurumda tek üyeliği veritabanı kısıtıyla da güvenceye alınır.
CREATE UNIQUE INDEX "memberships_institution_id_user_id_key" ON "memberships" USING btree ("institution_id","user_id");
