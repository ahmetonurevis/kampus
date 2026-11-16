---
etki: minor
---

- Etkinlik bileti ve oturma kuralları eklendi (ON-159, DOM-FIN-103; K-324…K-327): `lib/finance-event-tickets.ts` etkinlik açma ve düzeltme (`createEventSchema`, `updateEventSchema`, `planEvent`, `planEventUpdate`, `assertEventArchivable`; numaralı salon sıra × koltuk ve kapalı koltuklar ya da numarasız kontenjan, davetiye ve ücretli bilet türleri, öğrenci başına üst sınır), koltuk etiketleri (`seatLabel`, `parseSeat`, `layoutSeats`, `isSeatInLayout`, `compareSeats`), bilet ayırma (`planEventTicketAllocation`; alınmış koltuk 409 `event_seat_taken`), elle ödeme işareti (`planEventTicketPayment`), iptal ve iade işareti (`planEventTicketCancel`), girişte kod okutma (`planEventTicketCheckIn`), tahmin edilemez bilet kodu (`ticketCodeFromBytes`, `normalizeTicketCode`), özet (`eventTicketSummary`, `eventTicketState`) ve kodsuz satış listesi CSV'si (`eventTicketsCsv`).
