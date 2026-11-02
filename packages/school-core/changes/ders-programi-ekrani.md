---
etki: minor
---

Ders programı ve yedek görevlendirme web ekranı `/lessons` uçlarına bağlandı (OG-040; IST-094, DOM-YTK-068, DOM-YTK-069).

- Program Yönetimi (`/yonetici/program-yonetimi`, `/ogretmen/program-yonetimi`) genel iş akışı sayfasından çıkarıldı, kendi ekranı oldu: haftalık, günlük ve liste görünümü; sınıf, öğretmen, derslik ve tarih süzgeci adreste; liste sunucu sayfalı, CSV süzülmüş bütün sonucu içerir. Form iki adımlı değildir ("Kontrol et" yok); çakışma ve doğrulama hataları ilgili alanda görünür.
- İptal edilen ders yönetimde varsayılan olarak gizlidir; yönetici "İptalleri göster" (`?iptal=goster`) ile görür. Panel parametreleri `?ders=`, `?ders-form=`, `?ders-yedek=`, `?ders-iptal=` oldu; eski `?kayit=` bağlantıları ders açmaz.
- Yönetici gerekçeyle yedek öğretmen atar (aynı kampüs ve branştaki etkin öğretmenler) ve gerekçeyle iptal eder; başlamış ya da iptal edilmiş derste işlem görünmez. Öğretmen sayfayı salt okur (asıl ya da yedek olduğu dersler).
- Ders Programım (öğretmen, öğrenci) ve veli program sekmesi `GET /lessons` okur: yedek atanmış ders "Yedek: …" yazar, gerekçe gösterilmez, iptal edilen ders görünmez.
- `@kampus/react-shared`: `lessons.ts` (istek kurucular, `LESSON_MESSAGES`, hata alan eşlemesi) ve `use-lessons.ts` (`useLessonList`, `useLessonsInRange`, `useLessonsFetchAll`, `useLesson`, `useCreateLesson`, `useUpdateLesson`, `useSubstituteLesson`, `useCancelLesson`) eklendi.
