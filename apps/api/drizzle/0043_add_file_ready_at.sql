-- Dosyanın `ready` olduğu an (OG-995; ADR 0003 karar 5, 8). Numara 0043 görev satırında ayrıldı
-- (0041 ve 0042 başka göreve ayrıldı); kolon Drizzle şemasından üretildi. Bağsız dosyanın 24
-- saatlik ömrü bu andan sayılır: `clamd` kesintisinden sonra geç taranan dosya bağlanmadan önce
-- silinmez. Kolon boş eklenir ve geri doldurulmaz: eski `ready` satırlarda süre eskisi gibi
-- `created_at`'ten sayılır. Kolon içerik kolonu değildir; migration 0033 tetikleyicisi ona
-- karışmaz.
ALTER TABLE "files" ADD COLUMN "ready_at" timestamp with time zone;
