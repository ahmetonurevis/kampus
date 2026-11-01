---
name: yeni-modul
description: Kampüs'e yeni bir modül (ör. okuma-anlama, yazma rubriği, kaynak havuzu, ev okuma günlüğü) uçtan uca ekleme kontrol listesi — domain kuralı ve ister kimliği, school-core kaydı, Zod işlemleri, API, web-react (shadcn/ui + TanStack + react-hook-form), mobil, testler ve dokümanlar. Yeni modül ya da mevcut modüle yeni koleksiyon eklerken kullan.
argument-hint: <modül anahtarı ve kısa açıklama>
---

# Yeni modül ekleme

Referans: hedef & gelişim planı modülü — `git show f88815c --stat`. Aynı kalıbı izle. Paketler birleşmediyse adlar kural ve belgedeki gibidir (paket birleşince doğrulanır).

## 1. Tasarım (kod yazmadan)

- Dayanak: `docs/urun/ister-listesi.md`'den ister kimliği (`IST-…`) ve `docs/domain/*`'tan kural kimliği (`DOM-…`). Kural yazılı değilse önce domain belgesine ekle (kimlik bir kez verilir). Kimlikler commit gövdesine, test adlarına ve ilgili kod yorumuna girer.
- Roller ve her rolün görecekleri/yapacakları; kurum türü (`school`, `language_school`, ikisi); dil becerisi varsa CEFR ve beceri etiketi.
- Koleksiyonlar, doğrulama, mükerrer kayıt, durum geçişleri, silme yerine arşiv, hesaplanan değerin saklanmaması.
- Genel iş akışı tanımı yeterli mi, özel ekran mı gerekiyor? Önce geneli dene.

## 2. school-core

1. `modules/school-workflows`: modül kaydı (`key`, `title`, `path`, `icon`, `description`, `roles`).
2. `data/school-workflows`: deterministik örnek veri.
3. `lib/school-workflows`: Zod şeması, atomik işlemler, rol kapsamı. Kural reddi `DomainError` ile (`code`, Türkçe `message`, `kind`: `rule`/`conflict`/`forbidden`/`not_found`); düz `Error` veya string hata yok.
4. `lib/workflow-presentation`: liste sütunları, filtreler, form alanları, detay bölümleri.

## 3. API ve istemci

`api-ucu` skill'iyle. Demo kalıcılığına (`stores/demo.js`, `lib/demo-persistence.js`, mobil AsyncStorage snapshot'ı) yeni koleksiyon veya alan eklenmez; Vue `apps/web`'e yeni özellik eklenmez. Yeni akış API + `apps/web-react` üzerindedir.

## 4. Web ve mobil

- Web (`apps/web-react`, ADR 0002): shadcn/ui bileşenleri, liste `@tanstack/react-table`, form `react-hook-form` + Zod resolver, bildirim `sonner`, sunucu verisi `react-shared` hook'ları. Diyalog/tablo/form elle yazılmaz; mevcut ortak bileşen (`DataTable`, `ListFilters`, `Modal`…) önce. Cam yalnız yüzen katmanda; açık ve koyu tema; 320/390 px.
- Mobil: React Navigation, TanStack Query, react-hook-form; 48 dp hedef, büyük yazı, klavye açıkken form. İkon `src/ui/icons.*`'a.
- Vue karşılığı davranış referansıdır; e2e erişilebilir adları korunur.

## 5. Testler ve kapsam eşikleri

- Birim (school-core 90/85): başarı, her doğrulama hatasında kaydın değişmemesi, mükerrer, her rolün kapsamı, modül kapalı.
- API (api 85/80): `api-ucu` test listesi. api-client 90/85, react-shared 80/70.
- E2E (yalnız ana akış): rol geçişleri, modül kapatınca menü ve doğrudan erişim kapanır, dar/koyu ekranda taşma yok.
- Eşik yalnız yükselir; ölçüm komutu `dogrula` skill'inde.

## 6. Doküman ve commit

`docs/sayfalar.md`, README kısa bölüm, gerekiyorsa `docs/<modul>.md`; school-core `changes/<konu>.md` parçası (sürüm ve CHANGELOG teslimde); CLAUDE.md'ye 1–3 satır kalıcı kural. `dogrula` sonrası commit: "<Modül adı> modülünü ekle".
