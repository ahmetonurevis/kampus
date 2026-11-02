---
etki: patch
---

- React web Genel Bakış'a Vue'daki üç davranış eklendi (OG-225): yönetici ve ön büroda "Şube filtresi" (varsayılan tüm kampüsler, seçim adreste `?sube=`; öğrenci, sınıf, taksit, yoklama ve kampüs doluluğu seçili kampüse daralır), yönetici tahsilat grafiğinde "Grafik dönemi" (son 6 / 12 ay, adreste `?donem=`) ve "Bu ay tahsilat" ile "Genel not ortalaması" sayaçlarında gerçek kayıtlardan mini grafik (erişilebilir etiketli). `GET /api/v1/dashboard` yönetici ve ön bürosu için `branchId` kabul eder (olmayan kampüs 404, diğer rollerde 400); yöneticinin aylık tahsilat serisi 6 yerine 12 ay döner. `react-shared` `useDashboard` sorgusu `branchId` taşır. Core değişmedi.
