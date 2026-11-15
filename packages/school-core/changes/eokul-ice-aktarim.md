---
etki: minor
---

- e-Okul öğrenci listesi aktarımı eklendi (`lib/enrollment-eokul-import.ts`, DOM-KAY-042, IST-134): başlık satırı ilk 20 satırda bulunur, sütunlar başlık adlarından önerilir ve düzeltilebilir; satırlar T.C. kimlik ya da okul numarasıyla eşleşip yeni, güncellenecek, değişiklik yok ya da hatalı olarak sınıflanır; yeni öğrenci pilot aktarımının kuralıyla açılır, mevcut öğrencide ad, okul numarası, aynı düzeyde şube ve eksik kimlik yazılır.
- Pilot aktarımının kontenjan sayımı `classOccupancy` adıyla dışa açıldı (`lib/enrollment-import.ts`).
