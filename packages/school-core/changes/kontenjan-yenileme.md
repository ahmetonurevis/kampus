---
etki: patch
---

- Kesin kayıtta kontenjan, sınıfın aktif öğrencileriyle birlikte aynı sınıfa planlanmış yenilemeleri de sayar (DOM-KAY-010, ON-116); son yeri planlanmış yenileme tutuyorsa 422 `class_capacity_full`. Uygulanmış yenileme yer tutmaz, sınıfta zaten olan öğrencinin planı ikinci kez sayılmaz. `prospect.enroll` komutu `renewals` koleksiyonunu yükler.
