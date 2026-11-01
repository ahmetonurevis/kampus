# Ortak çalışma kuralları

Her oturumda yüklenir. Ayrıntı: `docs/muhendislik/git-ve-surum.md` §7; zorunlu özet kök `CLAUDE.md` "İki geliştiriciyle çalışma".

İlke: izin yok, görünürlük var. Kendi alanında sormadan yaz, birleştir, gönder; işi issue'da görünür tut. Hook'lar insan onayı istemeden denetler.

- Alan haritası `.claude/alanlar.json`: Onur kayıt ve finans, Oğuzhan geri kalan her şey (haritada sahibi olmayan yol Oğuzhan'ındır), `shared` listesi ortak sıcak dosyalardır. Bir yolun sahibi: `echo <yol> | node .claude/hooks/alan-koruma.ts --classify`.
- Oturumdaki kullanıcı `git config kampus.sahip` (yoksa `user.name`) ile belirlenir. `alan-koruma` hook'u diğer sahibin dosyasına yazmayı engeller; engel gelirse dosyayı başka yoldan (Bash, `sed`, `cp`) değiştirmeye çalışma.
- Karşı alanda bir şey gerekince (değişiklik isteği akışı):
  1. Dur, kullanıcıya şıklı sor: iş isteği issue'su açılsın mı, kullanıcı dosyayı kendisi mi açacak.
  2. İş isteği issue'su (izin isteği değil) alan sahibinin etiketiyle (`sahip:onur`/`sahip:oguzhan`) açılır: gerekçe, istenen davranış, etkilenen dosyalar, bağlı iş `#<no>`. Etiket uydurulmaz; mevcutlar `sahip:onur`, `sahip:oguzhan`, `migration`, `ortak-dosya`, `durum:devam`, `bug`.
  3. Bu arada kendi taraf geçici veriyle yazılır; iş beklemez.
  4. Kullanıcı dosyayı açmak isterse yolu veya glob'u git'e girmeyen `.claude/alan-izni.local` dosyasına satır olarak kendisi ekler; ajan bu dosyayı kendiliğinden yazmaz.
- Ortak dosyada (`Ortak dosya` hatırlatması) kendi bloğuna yazılır, başkasının satırı yeniden sıralanmaz; blok dışına çıkılırsa issue'ya `ortak-dosya` etiketi konur, beklenmez. Entegrasyonu kıran, düzeltir ya da geri alır.
- Migration ve ADR numarası (sıradaki ADR 0007) issue başlığına yazılır ve kullanılır, onay beklenmez; `DOM-YTK` aralığı Oğuzhan 055–079, Onur 080–099. Çakışmada ikinci giren kendi migration'ını silip yeniden üretir. Bağımlılık eklemek serbest.
- core sürümü dalda verilmez: CHANGELOG'da `## Yayımlanmamış (<konu>)`. `openapi.json` ve `schema.d.ts` elle birleştirilmez, yeniden üretilir; lockfile `pnpm install` ile.
- `push-kontrol` hook'u force push, `+refspec`, `main`'e push ve güncel entegrasyonu birleştirmeden ya da aynı numaralı migration'la entegrasyon dalına push'u engeller. Push reddedilirse: fetch, merge, test, yeniden push; geçmiş yeniden yazılmaz.
