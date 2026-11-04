---
etki: patch
---

- Örnek veride her sözleşme kendi taksitlerini `invoiceIds` ile listeler (ON-046, DOM-FIN-012). Önceden seed'deki 3.840 taksitin hiçbiri bir sözleşmeye bağlı değildi; sözleşme belgesi, ayrılış ve yenileme bu durumda öğrencinin bütün taksitlerine düşüyordu. Kimlikler, tutarlar ve tarihler değişmez; taksitlere `contractId` eklenmez (işlemlerin açtığı taksitleri ayırt etmek için kalır). `State` tipinde `contracts[].invoiceIds` eski kayıtlar için isteğe bağlı kalır.
