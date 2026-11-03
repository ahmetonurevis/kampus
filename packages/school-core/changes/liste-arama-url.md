---
etki: minor
---

- React web listelerinde arama metni artık adres çubuğuna (`?q=`, `?<önek>q=`) yazılmadı (ADR 0009, IST-028, OG-066): öğrenci/veli adı ve telefon tarayıcı geçmişine, paylaşılan bağlantıya ve erişim loguna girmez. Arama liste ve çocuk/sekme kapsamı başına bellekte tutuldu; geri/ileri ve sayfa içi gezinmede geri gelir, tam yenilemede kaybolur. Filtre, sıralama ve sayfa adreste kaldı.
- Eski bağlantıdaki `q` bir kez okunup arama kutusuna konuldu ve geçmişe yeni girdi eklenmeden (`replace`) adresten silindi.
- `useListState` `searchInUrl` seçeneği etkisiz kılındı (`@deprecated`); `DataTable` `searchInUrl` özelliği kaldırıldı.
