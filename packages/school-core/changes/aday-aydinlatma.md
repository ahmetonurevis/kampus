---
etki: minor
---

- Aydınlatma metni deposuna aday kitlesi eklendi (iş isteği #14; DOM-KAY-003, DOM-YTK-056): `NOTICE_AUDIENCES.aday`. Yönetici aday metnini diğer kitleler gibi sürümlü yayımlar. Kitle tanımı `account` alanını taşır; aday hesaba bağlı olmadığından hiçbir rolün kitlesi değildir ve gösterim kaydı açılmaz. Güncel metni okunacak kitleyi `noticeAudienceForRead` çözer: aday metnini yalnız aday formunu açan roller (`PROSPECT_NOTICE_READERS`: yönetici, ön büro) okur, başka rol ve başka hesap kitlesi 403 `notice_audience_forbidden`.
