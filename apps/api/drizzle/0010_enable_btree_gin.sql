-- İçerik havuzu arama indeksi `(institution_id, search_vector)` bileşik GIN'dir (veritabani.md §6):
-- `text` kolonun GIN operatör sınıfı `btree_gin` eklentisindedir. PostgreSQL 13+ eklentiyi güvenilir
-- sayar; veritabanı sahibi rol süper kullanıcı olmadan kurabilir. PGlite'ta contrib eklentisiyle açılır.
CREATE EXTENSION IF NOT EXISTS btree_gin;
