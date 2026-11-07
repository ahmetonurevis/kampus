---
etki: minor
---

- Yetişkin kursiyerin veli erişimi kuralı eklendi (ON-129; DOM-KAY-012, DOM-ILT-070, DOM-ILT-074, DOM-YTK-057; kullanıcı kararı 2 Kasım 2026): `lib/enrollment-guardian-access.ts` (`learnerConsentRequired`, `effectiveCustody`, `withLearnerConsent`, `studentsNeedingLearnerFacts`). Kursta 18 yaş ve üstü kursiyerin velayetli bağı (`full`, `joint`) yalnız kursiyerin geçerli rızasıyla kapsam verir; rızasız bağ okuma kapsamında velayetsiz sayılır. Bağ silinmez, ödeyicilik sürer (ödeyici bağlantısı velayetten bağımsızdır, K-04). Okulda ve 18 yaş altında değişiklik yoktur. Kural API okuma kapsamına henüz bağlı değildir: rıza amacı (`consent-purposes.ts`) ve aktör bağlantılarının kurulduğu yer (`services/memberships.ts`) Oğuzhan'ın alanındadır.
