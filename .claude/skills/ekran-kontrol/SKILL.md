---
name: ekran-kontrol
description: Kampüs web arayüzünü görsel olarak kontrol etme — route'ları açık/koyu temada ve masaüstü/dar ekran genişliğinde görüntüleyip yatay taşma ve konsol hatası raporlamak, PNG'leri inceleyip Vue referansıyla karşılaştırmak. Ekran, yerleşim, tema veya token değiştirdikten sonra ve commit öncesi kullan.
---

# Ekran kontrolü

`scripts/ekran-kontrol.ts` verilen route'ları Playwright (Chromium) ile açar, geçişlerin bitmesini bekler, her tema × genişlik için PNG çeker; yatay taşmayı (taşan öğelerle) ve konsol hatalarını `rapor.json`'a yazar. Sorun varsa çıkış kodu 1'dir.

## Ne zaman

- `apps/web-react` altında ekran, yerleşim, ortak bileşen, `tokens.css`/`app.css` değiştiğinde.
- Vue (`apps/web`) davranış referansını görmek gerektiğinde (aynı betik, `--base` ile).
- e2e'nin yerine geçmez: akış ve kurallar e2e/birim testindedir; bu kontrol görünüm içindir.

## Komutlar

```bash
# API + veritabanı (paylaşılan sunucuda ayrı veritabanı kullan; DATABASE_URL yalnız ortamda)
docker compose up -d
pnpm --filter @kampus/api db:migrate && pnpm --filter @kampus/api db:seed
pnpm dev:api                        # 3000; başka port: PORT=… ve web için KAMPUS_API_URL=…
pnpm dev:react                      # 5174, /api → API vekili (paralel çalışmada görevdeki portu kullan)
node scripts/ekran-kontrol.ts --routes /giris
node scripts/ekran-kontrol.ts --rol yonetici --routes /yonetici/dashboard,/yonetici/finans,/yonetici/olmayan
node scripts/ekran-kontrol.ts --rol veli --routes /veli/dashboard --widths 1440,390,320 --tam --cikis
node scripts/ekran-kontrol.ts --eposta murat.yilmaz@kampus.example --routes /yonetici/dashboard
node scripts/ekran-kontrol.ts --routes /giris --azaltilmis-hareket --out artifacts/ekran-kontrol/giris
```

- Varsayılanlar: `--base http://127.0.0.1:5174`, temalar `light,dark`, genişlikler `1440,390`, yükseklik 900, çıktı `artifacts/ekran-kontrol` (git'e girmez).
- `--rol <anahtar>`: rolün Akademi demo hesabıyla (`apps/api/src/db/demo-seed.ts`) giriş formundan gerçek Better Auth girişi yapar; `--eposta` hesabı, `--parola` parolayı değiştirir (varsayılan `DEMO_PASSWORD` ya da demo parolası). Oturum çerezdedir: route'lar tam sayfa açılır, çerez diğer temalara taşınır. Giriş ucu dakikada 5 denemeyle sınırlıdır; betik koşu başına bir kez girer, art arda çok rol koşarken 429 alırsan bir dakika bekle.
- `--cikis`: son temada avatar menüsünden çıkış yapar ve ilk route'un girişe yönlendiğini denetler.
- Rapor, tema tercihi ve react-router kaydırma konumu dışında `localStorage`/`sessionStorage`'a yazılan her anahtarı (`DEPO`) sorun sayar.
- Vue referansı: `pnpm --filter @kampus/web dev --port 5175` ve `--base http://127.0.0.1:5175`, `--rol` olmadan (Vue rolü URL'den alır). İş bitince sunucuyu kapat: `lsof -ti:5175 | xargs kill`.

## İnceleme

1. Komut çıktısındaki `✗` satırlarını ve `taşan:` öğelerini düzelt; 390 ve 320 px'te yatay taşma olmamalı.
2. PNG'leri Read aracıyla aç ve bak; açık ve koyu temanın ikisini de incele. Kontrol listesi:
   - Görünüm Vue ile aynı temada: safir sidebar, 12 px iç boşluklu yüzeyler, kısa turuncu aktif pill, 11/10 px menü yazıları.
   - Cam yalnız yüzen katmanda (sidebar, navbar, menü, diyalog, toast); tablo, form ve kartlar opak.
   - Metin kontrastı her iki temada okunaklı; odak halkası sabit katmanın altında kalmıyor.
   - Dar ekranda hamburger "Menüyü aç", breadcrumb yalnız başlık; web dokunma hedefleri en az 24×24 px (WCAG 2.2; 44/48 dp yalnız mobil uygulama içindir).
3. Vue ile karşılaştırma gerekiyorsa aynı route'u Vue'dan da çek ve iki PNG'yi yan yana oku.
4. Raporda görüntü sayısını ve sorun sayısını yaz ("12 görüntü, 0 sorunlu").
