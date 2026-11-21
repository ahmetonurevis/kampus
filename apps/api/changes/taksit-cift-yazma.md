---
etki: minor
---

Taksit ve sözleşme tablolarına çift yazma başladı (ON-046e; ADR 0010 adım 3). Migration 0063 `records` taksit ve sözleşmelerini `invoices`, `contracts` ve `contract_invoices` tablolarına kopyalar; sözleşmesiz eski taksit, onu `invoiceIds`'inde taşıyan ilk sürüme ya da öğrencinin tek sözleşmesine bağlanır (kaynakta `contractId` yazılır, sürüm artar), aynı zincirde taksit numarasını yineleyecekse bağ boş kalır. Çalıştırıcı ve tohum bundan sonra iki yere aynı transaction'da yazar; kaynak `records`'tır, tabloya sığmayan eski kayıt işlemi durdurmaz. Onaylı sözleşmeye bağlı taksitin koşulunu değiştiren yazma artık veritabanında reddedilir (DOM-FIN-010). Uç ve yanıt şekli değişmedi.
