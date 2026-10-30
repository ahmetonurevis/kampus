---
paths:
  - '**/package.json'
  - 'pnpm-workspace.yaml'
  - 'pnpm-lock.yaml'
  - 'apps/web-react/components.json'
---

# Bağımlılık kuralları

Ayrıntı: `docs/muhendislik/kod-yazim.md` §8, paket listesi ADR 0002.

- Önce hazır paket: genel sorun (tablo, form, diyalog, menü, bildirim, tarih seçici, kimlik, sorgu önbelleği, kuyruk, e-posta, depolama) için kendi kütüphanemiz yazılmaz. Kendi kodumuz yalnız school-core alan kuralı, paketleri bağlayan ince katman ve tasarım tokenlarıdır.
- Önce ADR 0002 listesine bakılır; aynı ihtiyaç için ikinci paket (tablo, form, tarih, ikon, durum yönetimi, UI kitaplığı) ADR'siz eklenmez.
- Listede olmayan paket şu ölçütlerin hepsini karşılar:
  - Bakım: son 6 ayda sürüm, birden çok bakımcı veya kurumsal destek, arşivlenmemiş.
  - TypeScript tipleri pakette (veya iyi bakılan `@types`); Node 24, React 19, Expo SDK 57 ile uyumlu, ESM.
  - Lisans: MIT, Apache-2.0, BSD-2/3-Clause (ISC, 0BSD eşdeğer). GPL/AGPL/LGPL/SSPL/BUSL/NC/lisanssız yasak.
  - Erişilebilirlik (arayüz paketi): WAI-ARIA deseni, klavye ve ekran okuyucu desteği belgeli.
  - Boyut: ağaç sarsılabilir; web ilk yüklemesine ≤ 30 KB gzip, fazlası rota parçasına veya `import()`'a.
  - `minimumReleaseAge` beklemesine uyar; istisna yalnız `minimumReleaseAgeExclude`'a tam sürüm ve gerekçeyle.
  - Kurulum betiği yok tercih edilir; varsa `allowBuilds`/`onlyBuiltDependencies`'e gerekçeyle. Telemetrisi kapatılamayan veya dış servise veri gönderen paket eklenmez.
- Sürüm tam sabitlenir (`"zod": "4.6.5"`); `^`/`~` yok. İstisna: Expo SDK paketleri `pnpm expo install` ile `~`. Dokunulan `^` girdisi tam sürüme çevrilir.
- Bağımlılık onu kullanan pakete eklenir; kök yalnız araç zinciri. Lockfile aynı committe.
- Commit gövdesinde: paket@sürüm, neden (ADR 0002 paketi neden yetmiyor), alternatifler, bakım, tipler, lisans, erişilebilirlik, boyut, kurulum betiği.
- shadcn/ui bileşenleri CLI ile `src/components/ui/`'ye alınır; değişiklik token ve erişilebilirlikle sınırlı. Üretilen kod (OpenAPI tipleri, Better Auth şeması, migration) elle düzenlenmez.
- İç paketler `workspace:x.y.z` ile tam sürüme sabitlenir; sürüm artınca tüketiciler aynı committe güncellenir.
- Kullanılmayan bağımlılık aynı committe kaldırılır.
