---
name: yeni-modul
description: Kampüs'e yeni bir modül (ör. okuma-anlama, yazma rubriği, kaynak havuzu, ev okuma günlüğü) uçtan uca ekleme kontrol listesi — school-core kaydı, örnek veri, Zod işlemleri, liste/form/detay tanımı, API, web, mobil, testler ve dokümanlar. Yeni modül ya da mevcut modüle yeni koleksiyon eklerken kullan.
argument-hint: <modül anahtarı ve kısa açıklama>
---

# Yeni modül ekleme

Referans: hedef & gelişim planı modülü — `git show f88815c --stat` (11 dosya, ~880 satır). Önce onu oku, aynı kalıbı izle.

## 1. Tasarım (kod yazmadan)

- Roller ve her rolün göreceği/yapacağı; kurum türü (okul, dil okulu, ikisi). Dil becerisi içeriyorsa CEFR seviyesi ve beceri etiketi.
- Koleksiyonlar ve alanlar. İş kuralları: doğrulama, mükerrer kayıt, kapsam, durum geçişleri, silme yerine arşiv, hesaplanan değerin saklanmaması.
- Mevcut modüllerle bağlantı: çalışma planı, takvim, hedef, mesajlar, finans, kaynak havuzu.
- Genel iş akışı tanımı (web `SchoolWorkflows`, mobil `WorkflowScreen`) yeterli mi, özel ekran mı gerekiyor? Önce geneli dene.

## 2. school-core

1. `src/modules/school-workflows.*`: modül kaydı (`key`, `title`, `path`, `icon`, `description`, `roles`).
2. `src/data/school-workflows.*`: deterministik örnek veri.
3. `src/lib/school-workflows.*`: Zod şeması, atomik işlemler, rol kapsamı.
4. `src/lib/workflow-presentation.*`: liste sütunları, filtreler, form alanları, detay bölümleri.
5. Eski kayıt uyumu: yeni koleksiyon yoksa varsayılandan gelir; modül varsayılanı eski tercihlerle birleşir.

## 3. API ve istemci

`api-ucu` skill'iyle okuma ucu (rol kapsamıyla) ve işlem uçları; `api-client` ve `react-shared` hook'ları.

## 4. Web ve mobil

- Genel tanım yeterliyse ek ekran gerekmez. Yeni ikon web ikon listesine ve mobil `src/ui/icons.*`'a; yeni durum rengi rozet bileşenine eklenir.
- Ses, kayıt veya çok boyutlu filtre gibi genel tanımın karşılamadığı ihtiyaçlar küçük, tekrar kullanılabilir bir bileşenle çözülür.
- Mobilde dar ekran, büyük yazı ve klavye açıkken form kontrol edilir.

## 5. Testler

- Birim: başarılı akış, her doğrulama hatasında kaydın değişmemesi, mükerrer işlem, her rolün kapsamı, modül kapalıyken ret, kalıcılık gidiş-dönüşü.
- API: 401/403/404/400/başarı.
- E2E: ana akış rol geçişleriyle; modül kapatınca menü ve doğrudan erişim kapanır; dar ve koyu ekranda taşma yok.

## 6. Doküman, sürüm, commit

`docs/sayfalar.md`, README kısa bölüm, gerekiyorsa `docs/<modul>.md`; school-core `CHANGELOG.md` + sürüm + tüketici sabitlemeleri; CLAUDE.md iş kuralları bölümüne 1–3 satır kalıcı kural. `dogrula` merdiveninden sonra commit: "<Modül adı> modülünü ekle".
