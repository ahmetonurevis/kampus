-- Bildirim sorguları için ifade indeksi (OG-020, IST-065): görünürlük süzgeci öğrenci kimliğine
-- eşitlik, sıra position/id. `concurrently` değildir: Drizzle migrator tek transaction'da koşar
-- (veritabani.md §indeks); bildirim satırı olmayan/küçük veritabanında kurulum kısadır, dolu
-- üretimde çalıştırıcı kararı (veritabani.md açık karar) önce uygulanır.
CREATE INDEX "records_notifications_idx" ON "records" USING btree ("institution_id",("data" ->> 'studentId'),"position","id") WHERE "records"."collection" = 'notifications' and "records"."archived_at" is null;