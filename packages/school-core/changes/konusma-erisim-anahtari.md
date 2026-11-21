---
etki: patch
---

- Yöneticinin gerekçeli yazışma erişimi (`POST /conversations/{id}/access`, DOM-YTK-052) isteğe bağlı `Idempotency-Key` alır: aynı anahtarla tekrar eden istek ilk yanıtı `Idempotent-Replayed: true` ile döndürür ve ikinci `conversation.access` denetim kaydı yazmaz. `If-Match` yoktur: erişim yazışmayı değiştirmez, korunacak sürüm yoktur. React istemcisi (`openAccessRequest`) anahtarı gönderir (OG-231).
