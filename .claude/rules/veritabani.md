---
paths:
  - 'apps/api/src/db/**'
  - 'apps/api/drizzle/**'
---

# Veritabanı kuralları

Ayrıntı: `docs/muhendislik/veritabani.md`.

- Tablo ve kolon adları snake_case İngilizce, tablo çoğul. Kısıt/indeks adı `<tablo>_<kolonlar>_idx|_key|_fkey|_check`.
- Kurum tablolarında zorunlu: `institution_id` (PK ve her indeksin ilk kolonu), `created_at`, `updated_at`, `archived_at`, `version`. İstisna yalnız Better Auth tabloları, `audit_log`, `idempotency_keys` ve `pg-boss` şeması.
- Kimlik tabloları Better Auth CLI ile `src/db/schema/auth.ts`'e üretilir, elle düzenlenmez, doğrudan `update`/`delete` yazılmaz; üyelik–school-core bağlantısı `membership_links`'te.
- Tipler: zaman `timestamptz`, gün `date`, para `bigint` kuruş + `currency`, durum `text` + `check` (PostgreSQL enum yok), metin `text`.
- `records`: `collection` school-core state anahtarıdır; `data` yazmadan önce school-core Zod şemasıyla doğrulanır, bütün olarak ve `where version = $beklenen` ile yazılır (0 satır → 409). `jsonb_set` ile parça güncelleme, hesaplanan değer, dosya/base64 yok; belge ≤ 256 KB. Yükleme core dizi sırasıyla (`position`, seyrek tamsayı; `positions.ts`).
- Bir işlemin bütün yazmaları ve `audit_log` kaydı tek transaction'dadır; işlem çalıştırıcı yüklemeden önce kurum danışma kilidini alır (`lockInstitution`), kurum içi işlemler sıraya girer.
- Normalleştirme (ayrı ADR): kurumda 20.000+ kayıt, veritabanı kısıtı ihtiyacı, SQL raporlama, yükleme p95 > 50 ms veya > 5 MB, özel nitelikli veri.
- Migration yalnız `drizzle-kit generate --name <ne_yapildigi>`; SQL okunur ve commit edilir. `push` yalnız atılacak yerel veritabanında.
- Uygulanmış migration değiştirilmez; düzeltme ve geri alma yeni migration'dır. Kırıcı değişiklik genişlet/daralt ile iki adım.
- Büyük tabloya `check`/yabancı anahtar eklerken `not valid` + ayrı migration'da `validate constraint` (uzun kilit yok).
- Migration ve onu kullanan kod aynı committe; testler aynı migration'ları PGlite'ta baştan uygular.
- Benzersizlik `institution_id` içerir; arşivli kayıtları dışlamak için kısmi indeks (`where archived_at is null`). Her yabancı anahtar indekslidir. `data` üzerinde ölçümsüz GIN indeksi yok; yeni indeks `EXPLAIN` ile gerekçelendirilir.
- Silme = arşiv (`archived_at`); sorgular varsayılan olarak arşivliyi dışlar. Kalıcı `delete` yalnız imha işi, veri sahibi talebi ve süresi dolan teknik kayıtlarda.
- `audit_log` yalnız eklenir; uygulama rolünde `update`/`delete` yetkisi yok. `changes` alan adlarını tutar, özel nitelikli değer tutmaz; `reason` (≤ 500 karakter) yalnız gerekçeli hassas okumada dolar ve DOM-YTK-053 maskesine tabidir; ham IP yok. Core `audit` koleksiyonu `records`'a yazılmaz; sunucu denetimi yalnız `audit_log`'da.
