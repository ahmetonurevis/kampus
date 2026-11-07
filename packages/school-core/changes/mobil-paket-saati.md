---
etki: minor
---

- Mobil API modunda dil okulu öğrencisi için "Paket saatlerim" bölümü eklendi (ON-302, K-24, DOM-DIL-051): paket adı, kalan saat, son kullanma ve durum. Kalan paket saati ödeme bilgisi sayılmaz; tutar gösterilmez, öğrenci ödemeleri telefonda kapalı kalır. Okul kurumunda, başka rolde ve finans modülü kapalıyken bölüm çizilmez, istek atılmaz. Bölüm (`apps/mobile/src/api/screens/finance-package-hours.tsx`) öğrenci ana ekranına bağlanınca görünür.
