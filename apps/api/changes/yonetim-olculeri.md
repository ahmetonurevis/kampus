---
etki: minor
---

Yönetim ekranı ölçü uçları (OG-038; IST-010).

- `GET /api/v1/class-metrics` (modül `academic`) sınıf başına aktif öğrenci sayısı, notu olan öğrenci sayısı ve not ortalamasını döndürür. Ortalama yuvarlanmamış öğrenci ortalamalarının ortalamasıdır ve yalnız sonda bir kez yuvarlanır (DOM-AKD-003); güncel sınıf esastır; sayı olmayan ve 0-100 dışı puan atlanır; notu olmayan öğrenci ortalamaya girmez (Vue demosu bu öğrenciyi 0 sayıyordu).
- `GET /api/v1/teacher-metrics` (modül `learning`) öğretmen başına geri çekilmemiş soru, 24 saat ihlali, uyum yüzdesi ve performansı döndürür; geri çekilen soru performansa sayılmaz (DOM-ILT-091). Arşivlenmiş kayıt ve geçerli oluşturma tarihi olmayan soru sayılmaz; bozuk tarih 500 vermez, yoklama ve ödev oranı 0-100'e sıkıştırılır.
- Toplamlar SQL'de hesaplanır, kayıtlar belleğe yüklenmez. Uçlar yalnız yöneticiye açıktır; aktör ilgili koleksiyonların tamamını okuyamıyorsa 403, modül kapalıysa 403 `module_disabled`, kurum türünde modül yoksa 404.
