# ADR 0005 · Yazışma mesajları ayrı kayıtlarda

- Durum: Kabul edildi (gece patron kararı, 2026-10-30)
- Onaylayacak: Oğuzhan Demirci (sabah gözden geçirme)
- Ayrıntılandırdığı: ADR 0001 karar 6 (kademeli normalleştirme), veritabani.md §3–§4

## Bağlam

Birebir yazışma (DOM-ILT-010…-012, -024) `records` tablosunda `conversations` koleksiyonunun tek kaydıydı. Mesajlar bu kaydın `data.messages` dizisinde tutuluyordu. Güvenlik incelemesi (R3) bu düzeni engelleyici buldu:

- **Belge sınırı:** kayıt en çok 256 KB'tır (`RECORD_MAX_BYTES`), mesaj ise 2000 karaktere kadar olabilir. Uzun bir yazışma birkaç yüz mesajda sınıra dayanır; ondan sonra her gönderim 422 `record_too_large` alır ve yazışma kilitlenir.
- **Yükleme:** işlem çalıştırıcı koleksiyonları bütünüyle yükler. Her mesaj gönderimi kurum kilidi altında kurumun bütün yazışmalarını, içindeki bütün mesajlarla birlikte yüklüyordu. Kurum içi bütün yazma işlemleri bu süre boyunca sıra bekliyordu.
- **Liste:** okunmamış sayısı ve son mesaj için her yazışmanın bütün mesajları uygulamaya çekiliyordu.

Web (W4) ve mobil (M3) iletişim ekranları API'ye yazılıyordu, bu yüzden HTTP yanıt şekli değişmemeliydi.

## Kararlar

1. **Mesaj başına bir kayıt.** Mesajlar yeni `conversationMessages` koleksiyonundadır (`records`, `collection = 'conversationMessages'`). Kimlik mesajın kimliğidir. Sıra deponun sırasıdır (`position`, kimlik) ve eklenme sırasıyla aynıdır. Mesaj değişmez; yalnız `readAt` bir kez yazılır.
2. **Mesaj, yazışmanın taraf anahtarlarını kopyalar:** `conversationId`, `studentId`, `teacherId`, `audience`, veli yazışmasında `parentUserId`. Bu anahtarlar yazışma açıldıktan sonra değişmez, yani kopya bayatlamaz. Kapsam kuralı (`READ_RULES.conversationMessages`) ve SQL süzgeci yazışmaya bakmadan karar verir. Hesaplanan değer değil, değişmez anahtar kopyasıdır.
3. **Yazışmada yalnız üst veri ve `lastMessageAt` kalır.** `lastMessageAt` liste sıralaması içindir. Onu her listede mesajlardan hesaplamak bütün yazışmaların mesajlarını taramak olurdu. Mesajı ekleyen işlem aynı transaction'da günceller. Okunmamış sayısı, son mesaj, mesaj sayısı ve yanıt bekleme saklanmaz; mesajlardan hesaplanır.
4. **Komutlar yalnız gerekeni yükler.** Bunun için çalıştırıcıya koleksiyon başına kısmi yükleme (`loadScope`) eklendi:
   - `message.send` hedef yazışmayı yükler, hiç mesaj yüklemez. Mesaj eklenir, var olanlar okunmaz.
   - `message.read` hedef yazışmayı ve yalnız o yazışmanın karşı taraf okunmamışlarını yükler.
   - `conversation.start` yalnız aynı öğrencinin yazışmalarını yükler; tekillik bu kümede denetlenir.
   - `conversation.access` yalnız hedef yazışmayı yükler.
5. **Okuma SQL'dedir.** `GET /conversations/:id/messages?cursor&limit` en yeniden geriye `(position, id)` sırasıyla `limit + 1` satır okur. İmleç mesaj kimliğidir; bu yazışmanın mesajı değilse 400. Liste satırının özeti yalnız sayfadaki yazışmalar için, yazışma başına indeksli `lateral` sorgularla hesaplanır. Mesajlar uygulamaya taşınmaz; yalnız son mesaj gelir. Sonuç core `digestMessages` ile aynıdır (test).
6. **Erişim.** `conversationMessages` genel koleksiyon okumasına kapalıdır. Mesajlar yalnız yazışmanın ucundan, taraf denetiminden sonra gelir; taraf olmayana 404 döner. Veli mesaj kuralı `parentUserId === actor.userId` ister (en az yetki).
7. **İndeksler** (`0009`, PG16 `EXPLAIN ANALYZE` ile ölçüldü; 50.000 mesaj, 200 yazışma):
   - `records_conversation_messages_idx (institution_id, (data ->> 'conversationId'), position, id) where collection = 'conversationMessages' and archived_at is null`. Sayfa geriye indeks taramasıyla 0,25 ms sürer. 20 yazışmalık liste özeti 10 ms sürer. Okundu yükü indeks taramasıyla 1,2 ms sürer; dizi adaylı `FieldMatch` ile ardışık taramada bu 19 ms idi. Bu yüzden kesin eşitlik süzgeci (`kind: 'equals'`) eklendi.
   - `records_institution_collection_position_idx (institution_id, collection, position)`. Sona ekleme sırası (`max(position)`) geriye tek adımda bulunur (0,08 ms); her eklemede koleksiyon taranmaz.
8. **Taşıma.** Migration `0009_split_conversation_messages` gömülü dizileri böler:
   - Kimlik korunur. Sıra kurum içinde yazışma sırası, sonra dizideki sıradır ve var olan mesaj kayıtlarının sonuna gelir.
   - Arşivli yazışmanın mesajları arşivli kalır.
   - Dizi, yalnız her öğesi bu yazışmanın mesaj kaydı olarak bulunuyorsa kaldırılır ve `lastMessageAt` yazılır. Taşınamayan öğesi (kimliksiz, nesne olmayan, çakışan kimlikli) olan yazışma olduğu gibi kalır; veri kaybı olmaz.
   - Yalnız `messages` alanı olan kayda dokunur, bu yüzden tekrar çalıştırmak etkisizdir.
   - Çevrimdışı demo kalıcılığı eski snapshot'ı yüklemede aynı biçimde böler (`splitLegacyMessages`).

## Sonuçlar

- Yazışmadaki mesaj sayısının üst sınırı kalmadı. Testte 307 mesajlı (2000 karakter) yazışmaya gönderim yazıldı ve sayfalar boşluksuz gezildi.
- Gönderimin yüklediği kayıt: önce kurumun bütün yazışmaları ve gömülü bütün mesajları; şimdi 1 yazışma ve 0 mesaj (SCOPE koleksiyonları değişmedi). Ölçüm `operation.applied` logundaki `loaded` alanıdır.
- Gönderim yanıtında `changes` sayıları değişti: mesaj artık `inserted: 1`'dir, yazışmanın `lastMessageAt`'i değişirse `updated: 1` olur. Okundu işaretinde `updated` işaretlenen mesaj sayısıdır. Yanıt şeması aynıdır.
- Denetim kaydının `changes.fields` alanında artık `messages` yerine mesaj kaydının alan adları (`text`, `sender` …) bulunur; metin yazılmaz.
- Core 2.7.0 kırıcıdır: State şekli ve `messagePage`, `conversationSummary`, `awaitingReply` imzaları değişti. Vue demosu ve mobil demo modu yeni şekle geçti.
- Kopyalanan taraf anahtarları yazışma değişirse güncellenmelidir. Bugün yazışmanın tarafını değiştiren işlem yoktur; eklenirse aynı işlemde mesajları da güncellemelidir.
- `records` modeli korunduğu için ADR 0004'ün ilişkisel tablo kararını beklemeden uygulandı. Mesajlar bir kurumda 20.000 kaydı geçeceği için veritabani §4 ölçütü 1'e girer. İlişkisel tabloya geçiş ayrı karardır (Alternatifler).

## Alternatifler

- **ADR 0004 yönünde ayrı ilişkisel tablo** (`conversation_messages`, tipli kolonlar ve yazışmaya yabancı anahtar). Uzun vadede doğru yön budur: veritabanı kısıtı, raporlama ve tipli indeks sağlar. Reddedildi (şimdilik), çünkü çalıştırıcı ve core State yalnız `records`'u bilir. Ayrı tablo ADR 0004 karar 2'deki "State dışı core" yapısını gerektirir, Vue/mobil demo kalıcılığı ise State'tedir. Bir gecede güvenle bitmezdi. Bu karar o geçişi kolaylaştırır: mesajlar zaten ayrı satırdır, taraf anahtarları da kolona dönüşmeye hazırdır.
- **Sınırlı dizi** (yazışmada son N mesaj, eskisi arşive). Belge sınırını korur ama gönderim yine bütün yazışmaları yükler. Eski mesajlar için ikinci bir depo ve sayfalama gerekir. Reddedildi.
- **Segment kaydı** (yazışma başına 100'er mesajlık parça kayıtları). Kayıt sayısını azaltır ama son parçaya ekleme parçanın tamamını yeniden yazar. Okundu işareti birden çok parçaya dağılır, eşzamanlı gönderimde aynı parça sürüm çakışması üretir. İmleç ve özet parça sınırlarını bilmek zorunda kalır. Reddedildi.
