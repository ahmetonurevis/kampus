---
etki: minor
---

- Programdan ek ders önerisi eklendi (`lib/finance-lesson-hour-suggestions.ts`, DOM-FIN-165): ders programındaki her ders 40 dakikalık ders saati sayısı kadar (en az 1; `lessonHourCount`) sayılır; iptal, kurum tatili, öğretmenin izinli ya da raporlu olduğu gün ve bitmemiş ders sayılmaz; yedek atanan ders yedeğe, telafi kendi kaydıyla sayılır (`makeupLinks`: açık `makeupForLessonId` ya da iptalden sonra açılan aynı sınıf ve ders); sınıfın yoklaması alınmamış günü işaretlenir (K-550).
- Haftalık dağıtım: pazartesi–pazar haftasında ilk `weeklyLoad` saat maaş karşılığı (varsayılan 15), `weeklyCap` saate kadarı ek ders (varsayılan 30), üstü sayılmaz; ay sonunu kesen haftada ek ders dersin gününün ayına yazılır (`lessonHourSuggestion`, `lessonSuggestionRange`, `lessonSuggestionQuerySchema`). Saat ya da ders saati ücretli öğretmene öneri verilmez, ana ücret tanımı yoksa aylık sayılır (`suggestionPayBasis`; K-551).
- Aktarım şeması ve planı (`lessonSuggestionTransferSchema`, `planLessonSuggestionTransfer`): öneri sunucudakiyle aynı olmalı, öneriden farklı saat gerekçe ister (5–500), elle giriş zaten o saatteyse aktarım yoktur; yalnız yönetici (`LESSON_SUGGESTION_ROLES`; K-552).
