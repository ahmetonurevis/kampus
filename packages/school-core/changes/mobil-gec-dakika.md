---
etki: minor
---

- Mobil öğretmen yoklamasında geç kalma dakikası girilir ve düzeltilir (OG-062, IST-124; DOM-AKD-036): "Geç geldi" işaretli öğrenci için sayısal klavyeli isteğe bağlı dakika alanı açılır; değer core `lateMinutesSchema` kuralıyla doğrulanır, ders süresi üst sınırının sunucu iletisi o öğrencinin alanına yazılır. Bugünkü kayıt yeniden açılınca kayıtlı dakika görünür; gönderim bütün geç gelenlerin dakikasını belirler. Web ve mobilin ortak yoklama modeli (`attendance-model.ts`: durum listesi, işaret hesabı, toplu işaretleme, geç dakika) `@kampus/react-shared`'e taşındı.
