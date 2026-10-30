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
pnpm dev:react                      # 5174 (paralel çalışmada görevdeki portu kullan)
node scripts/ekran-kontrol.ts --routes /giris
node scripts/ekran-kontrol.ts --rol yonetici --routes /yonetici/dashboard,/yonetici/finans,/yonetici/olmayan
node scripts/ekran-kontrol.ts --rol veli --routes /veli/dashboard --widths 1440,390,320 --tam
node scripts/ekran-kontrol.ts --routes /giris --azaltilmis-hareket --out artifacts/ekran-kontrol/giris
```

- Varsayılanlar: `--base http://127.0.0.1:5174`, temalar `light,dark`, genişlikler `1440,390`, yükseklik 900, çıktı `artifacts/ekran-kontrol` (git'e girmez).
- `--rol <anahtar>`: `/giris`'teki `[data-dev-role="<anahtar>"]` geliştirme düğmesiyle oturum açar, sonra route'ları istemci tarafında (`pushState` + `popstate`) değiştirir; oturum bellekte olduğundan tam sayfa yenilemesi girişe döner. Yalnız geliştirme sunucusunda çalışır (TODO(D2): Better Auth gelince test hesabıyla).
- Vue referansı: `pnpm --filter @kampus/web dev --port 5175` ve `--base http://127.0.0.1:5175`, `--rol` olmadan (Vue rolü URL'den alır). İş bitince sunucuyu kapat: `lsof -ti:5175 | xargs kill`.

## İnceleme

1. Komut çıktısındaki `✗` satırlarını ve `taşan:` öğelerini düzelt; 390 ve 320 px'te yatay taşma olmamalı.
2. PNG'leri Read aracıyla aç ve bak; açık ve koyu temanın ikisini de incele. Kontrol listesi:
   - Görünüm Vue ile aynı temada: safir sidebar, 12 px iç boşluklu yüzeyler, kısa turuncu aktif pill, 11/10 px menü yazıları.
   - Cam yalnız yüzen katmanda (sidebar, navbar, menü, diyalog, toast); tablo, form ve kartlar opak.
   - Metin kontrastı her iki temada okunaklı; odak halkası sabit katmanın altında kalmıyor.
   - Dar ekranda hamburger "Menüyü aç", breadcrumb yalnız başlık; dokunma hedefleri en az 44 px.
3. Vue ile karşılaştırma gerekiyorsa aynı route'u Vue'dan da çek ve iki PNG'yi yan yana oku.
4. Raporda görüntü sayısını ve sorun sayısını yaz ("12 görüntü, 0 sorunlu").
