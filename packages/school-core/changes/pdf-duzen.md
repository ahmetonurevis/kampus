---
etki: minor
---

- İade dökümünün terimleri kurum türünü izledi (ON-322, DOM-KAY-012): `withdrawalTargetLabel` okulda "Gittiği okul", dil okulu ve kursta "Gittiği kurum"; `paidTuitionLabel` okulda "Ödenen öğrenim ücreti", öteki türlerde "Ödenen kurs ücreti" döner. `contractLineRows` isteğe bağlı dördüncü parametre olarak kurum türünü aldı; verilmezse okul metni aynen kalır. İade hesap kırılımı PDF'i bu terimleri kullanır.
