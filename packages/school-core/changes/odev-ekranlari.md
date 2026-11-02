---
etki: minor
---

Web ödev ekranları ödev uçlarına bağlandı (OG-047; IST-095, DOM-AKD-070…074).

- Öğretmen Ödevler sayfası `/homework` ucundan sunucu sayfalı okur; sınıf, ders ve durum süzgeci var. Ödev ver, düzenle, onaylı arşiv ve teslimi puanlama (0–100, geri bildirim) aynı sağ panelde; sürüm çakışmasında girdi korunur.
- Öğrenci Ödevlerim panelinde not ve en çok 5 dosyayla teslim eder, puanlanmamış teslimini günceller; son teslim geçtiyse geç teslim uyarısı görünür, puanlanmış teslim kilitlidir. Veli Akademik Takip ödev sekmesi aynı paneli salt okur gösterir.
- react-shared'e ödev kancaları (`use-homework.ts`), Türkçe hata metinleri ve dosya okuma kancaları (`use-files.ts`) eklendi; `file_not_ready` mesajı "Dosyanız güvenlik taramasında, birazdan yeniden deneyin." oldu.
- Bilinen sınırlar: tarayıcı kapalı ortamda (`FILE_SCANNER=off`) yüklenen dosya `pending` kalır ve dosyalı teslim 422 `file_not_ready` alır (tarama: `dosya-tarama.md`); `/homework` listesinde başlık araması ve sıralama yok; yönetici menüsünde ödev sayfası yok.
