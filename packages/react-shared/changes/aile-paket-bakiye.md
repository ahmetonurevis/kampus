---
etki: minor
---

- `useStudentPackageBalance` kancası eklendi (ON-310, IST-114; `use-finance-packages.ts`): öğrencinin paket saat bakiyesini `/finance/students/:id/package-balance` ucundan okur. `packageHourRows` artık bakiye satırını alır (`saleId`, `expiredHours`) ve süresi dolan saati ayrı `expired` alanında verir; satış listesi satırı kabul edilmez.
