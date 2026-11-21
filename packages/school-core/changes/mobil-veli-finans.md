---
etki: minor
---

- Mobil API modunda veli için Finans & Ödeme Planı ve Dekontlar ekranları eklendi (ON-078; IST-107, IST-124; DOM-FIN-030, -033, -052, -054): seçili çocuğun bakiye özeti ve sıradaki taksidi, sunucu sayfalı taksitleri (durum süzgeci; ayrıntıda ödenen ve kalan kısım), cari ekstresi ve dekont numaralı tahsilat listesi (geçerli/iptal süzgeci). Ekranlar salt okurdur, çevrim içi ödeme yoktur; kapsam dışı öğrenci boş durum olarak anlatılır, PDF'ler web'de kalır. Satır görünümü `@kampus/react-shared/finance-parent-model.ts` içindedir. Ekranlar mobil ekran kaydına eklenince menüde görünür; öğrenciye açılmaz.
