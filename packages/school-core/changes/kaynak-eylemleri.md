---
etki: minor
---

- İçerik havuzunda kaynak eylemleri web'e eklendi (OG-217; DOM-KYN-025, 040, 050, 051): panelde `Paylaş` penceresi kapsam ve sınıf/öğrenci hedefi seçtirir (öğretmen yalnız ders verdiği sınıf ve öğrencileri görür); `Diğer işlemler` menüsünde `Kopyala`, gerekçeli `Telif bildirimi` ve yalnız yöneticide gerekçeli `Kaldır` bulunur. react-shared'e `useShareResource`, `useCopyResource`, `useReportResourceVersion`, `useRemoveResource` kancaları ve eylem görünürlüğünü core `planShareChange`, `planCopy`, `planVersionTransition` (`report`) ve `planResourceRemoval` kuru çalıştırmasıyla veren `resourceCommands` eklendi.
