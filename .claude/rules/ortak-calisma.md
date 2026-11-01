# Ortak çalışma kuralları

Her oturumda yüklenir. Ayrıntı: `docs/muhendislik/git-ve-surum.md` §7; zorunlu özet kök `CLAUDE.md` "İki geliştiriciyle çalışma". Skill'ler: `is-baslat`, `entegre-et`.

İlke: izin yok, görünürlük var; hız önce. Kendi alanında sormadan yaz, birleştir, gönder; işi issue'da görünür tut. Hook'lar insan onayı istemeden denetler. Yalnız sahiplik/kural değişikliği ve ürün-hukuk-maliyet kararları birlikte alınır.

- Alan haritası `.claude/alanlar.json`: Onur kayıt ve finans, Oğuzhan geri kalan her şey (haritada sahibi olmayan yol Oğuzhan'ındır), `shared` listesi ortak sıcak dosyalardır. Bir yolun sahibi: `echo <yol> | node .claude/hooks/alan-koruma.ts --classify`.
- Görev dağılımı `docs/is-bolumu/`: kendi listen `<sahip>.md`, yalnız sahibi düzenler; `README.md` ortaktır.
- Oturumdaki kullanıcı `git config kampus.sahip` (yoksa `user.name`) ile belirlenir. `alan-koruma` hook'u diğer sahibin dosyasına yazmayı engeller; engel gelirse dosyayı başka yoldan (Bash, `sed`, `cp`) değiştirmeye çalışma.
- Karşı alanda bir şey gerekince (değişiklik isteği akışı), durmadan:
  1. İş isteği aç (izin isteği değil): `gh issue create -R ahmetonurevis/kampus --label sahip:<karşı taraf>`; gerekçe, istenen davranış, etkilenen dosyalar, bağlı iş `#<no>`. Etiket uydurulmaz; mevcutlar `sahip:onur`, `sahip:oguzhan`, `migration`, `ortak-dosya`, `durum:devam`, `bug`.
  2. Kendi tarafını geçici veriyle (sabit, taslak arayüz) yazmaya devam et.
  3. Kaçış yolu: kullanıcı dosyayı açmak isterse yolu veya glob'u git'e girmeyen `.claude/alan-izni.local` dosyasına satır olarak kendisi ekler; ajan bu dosyayı kendiliğinden yazmaz.
- Ortak dosyada (`Ortak dosya` hatırlatması) kendi bloğuna yazılır, başkasının satırı yeniden sıralanmaz; blok dışına çıkılırsa issue'ya `ortak-dosya` etiketi konur, beklenmez.
- Migration ve ADR numarası (sıradaki ADR 0007) issue başlığına yazılır ve kullanılır, onay beklenmez; `DOM-YTK` aralığı Oğuzhan 055–079, Onur 080–099. Çakışmada ikinci giren kendi migration'ını silip yeniden üretir. Bağımlılık eklemek serbest.
- Sürüm dalda ve entegrasyonda verilmez, yalnız teslimde: davranış değişikliği `packages/school-core/changes/<konu>.md` parçası yazar; iç paketler `workspace:*`. README test sayıları yalnız teslimde.
- Üretilen dosyalar (`openapi.json`, `schema.d.ts`) elle birleştirilmez: `pnpm install && pnpm gen`.
- Push öncesi yalnız dokunulan paketlerin format/lint/typecheck ve ilgili birim/API testleri; tam set ve e2e CI'da. CI kırmızıysa kıran ilk iş düzeltir ya da geri alır (`git revert -m 1`).
- Küçük, mantıklı birim yeşil olunca hemen entegrasyona (`entegre-et`); uzun yaşayan dal yok.
- `push-kontrol` hook'u force push, `+refspec`, `main`'e push ve güncel entegrasyonu birleştirmeden ya da aynı numaralı migration'la entegrasyon dalına push'u engeller. Push reddedilirse: fetch, merge, test, yeniden push; geçmiş yeniden yazılmaz.
