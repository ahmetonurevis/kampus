---
etki: minor
---

- Burs fonu kuralları eklendi (ON-259; DOM-FIN-068): `lib/finance-scholarship-funds.ts` fon kaydı şeması (bağışçı en az veriyle, anonimde ad yok), bağış girişi (kuruş, gelecek gün yok), fondan burs ataması (fon bakiyesini ve bursun fonlardan karşılanmamış kısmını aşamaz, aynı fondan aynı bursa tek geçerli atama), bağış ve atama iptali (bağış iptali bakiyeyi eksiye düşüremez), sıfır bakiyede kapanış, bakiye toplamları, yürüyen bakiyeli hareket dökümü ve CSV üreticisi.
