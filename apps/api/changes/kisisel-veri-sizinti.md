---
etki: patch
---

- Kurumsal müşterinin etkin çalışan sayısı ve çalışan listesindeki `status` süzgeci bağın tarih aralığına göre hesaplanacak biçimde düzeltildi (DOM-FIN-060): bitişi ileri tarihli bağ bitişine kadar etkin, bitişi bugünden önce olan bağ `ended` sayılır; bugün bitmemiş (etkin ya da başlangıcı ileri tarihli) bağı olan şirket arşivlenmez.
- Kurumsal katılım özeti grup birleştirmesinden sonra da kur kaydının ilk katılma gününe bakacak biçimde düzeltildi (DOM-FIN-060, DOM-DIL-042): birleştirmenin hedefe yazdığı yeni kaydın günü değil, taşınan kaydın ilk katılma günü sayılır; bağdan önce başlamış, kursiyerin kendi ödediği kur birleştirmeyle özete girmez.
