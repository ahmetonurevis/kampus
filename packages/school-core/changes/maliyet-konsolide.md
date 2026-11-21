---
etki: minor
---

- Öğrenci başı maliyet ve çok kampüslü konsolide rapor eklendi (ON-249, ON-250; DOM-FIN-065): `lib/finance-cost-per-student.ts` dönemde kayıtlı öğrencileri kampüs, sınıf düzeyi ve kur bağıyla yerleştirir (`periodStudents`), bütçe giderini maliyet merkezlerine dağıtıp ortak (birim) gideri öğrenci sayısı ya da eşit anahtarla yukarıdan aşağıya paylaştırır (`costPerStudent`, `splitByWeights`), 5 öğrenciden küçük grupta öğrenci başı değeri gizler ve CSV üretir; `lib/finance-campus-consolidation.ts` kampüs başına tahakkuk, tahsilat, iptal, iade, öğrenci sayısı ve bütçe giderini muhasebe aktarımının satır üreticileriyle hesaplar, kampüsler toplamını ve payları verir (`campusConsolidation`, CSV).
