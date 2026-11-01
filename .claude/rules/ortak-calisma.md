# Ortak çalışma kuralları

Her oturumda yüklenir. Ayrıntı: `docs/muhendislik/git-ve-surum.md` §7; zorunlu özet kök `CLAUDE.md` "İki geliştiriciyle çalışma". Skill'ler: `is-baslat`, `entegre-et`. İlk kurulum: `docs/is-bolumu/ilk-kurulum.md`.

İlke: izin yok, görünürlük var; hız önce. Kendi alanında sormadan yaz, birleştir, gönder; işi görev tablosunda görünür tut. Hook'lar insan onayı istemeden denetler. Yalnız sahiplik/kural değişikliği ve ürün-hukuk-maliyet kararları birlikte alınır.

- Alan haritası `.claude/alanlar.json`: Onur kayıt ve finans, Oğuzhan geri kalan her şey (haritada sahibi olmayan yol Oğuzhan'ındır), `shared` listesi ortak sıcak dosyalardır. Bir yolun sahibi: `echo <yol> | node .claude/hooks/alan-koruma.ts --classify`.
- Oturumdaki kullanıcı `git config kampus.sahip` (yoksa `user.name`) ile belirlenir. `alan-koruma` hook'u diğer sahibin dosyasına yazmayı engeller; engel gelirse dosyayı başka yoldan (Bash, `sed`, `cp`) değiştirmeye çalışma.
- **Görev durumu tabloda tutulur, issue'da değil.** Tablon `docs/is-bolumu/<sahip>.md`, yalnız sahibi düzenler; satır `ID | Görev | … | Durum | Dal / commit | Not`. Durum yalnız `bekliyor`, `çalışılıyor`, `revizyon`, `engelli`, `bitti`, `iptal`. ID kalıcıdır; yeni görev dalga tablosunun sonuna sıradaki numarayla eklenir, silinmez `iptal` olur. Oturum hook'u iki tablonun özetini gösterir.
- Durum değişikliği güncel entegrasyon dalında tek satırlık commit'tir ("Görev durumunu güncelle: OG-012 çalışılıyor") ve hemen gönderilir; Onur'un oturumu kendisi push eder, Oğuzhan tarafında push'u kullanıcı yapar (oturum komutu verir).
  - Başlarken (`is-baslat`): sıradaki `bekliyor` görev (önce dalga, sonra bağımlılık) → `çalışılıyor`, Dal sütunu dal adı; sonra dal açılır.
  - Bitirince (`entegre-et`): entegrasyona birleşince `bitti`, Dal / commit sütunu birleştirme commit'inin kısa hash'i (birleştirmenin hemen arkasındaki commit).
  - Revizyon: inceleme, kullanıcı ya da karşı tarafın issue'su düzeltme isterse sahip `revizyon` yapar, Not'a gerekçe ya da `#issue`.
  - Engel: Not'a beklenen ID ("ON-014 bekleniyor"); o görev bitince durum `bekliyor`a döner.
- Issue yalnız karşı taraftan iş isteği ve hata bildirimidir: `gh issue create -R ahmetonurevis/kampus --label sahip:<karşı taraf>` (gerekçe, istenen davranış, dosyalar, bağlı görev ID'si); durmadan kendi tarafını geçici veriyle yaz. Etiket uydurulmaz: `sahip:onur`, `sahip:oguzhan`, `migration`, `ortak-dosya`, `bug` (`durum:devam` artık kullanılmaz). Kaçış: kullanıcı karşı alandaki yolu git'e girmeyen `.claude/alan-izni.local` dosyasına kendisi ekler; ajan bu dosyayı yazmaz.
- Ortak dosyada (`Ortak dosya` hatırlatması) kendi bloğuna yazılır, başkasının satırı yeniden sıralanmaz; blok dışına çıkılırsa görev satırının Not'una "ortak dosya" yazılır, beklenmez.
- Migration ve ADR numarası (sıradaki ADR 0007) görev satırının Not'una yazılır ve durum commit'iyle duyurulur, onay beklenmez; `DOM-YTK` aralığı Oğuzhan 055–079, Onur 080–099. Çakışmada ikinci giren kendi migration'ını silip yeniden üretir. Bağımlılık eklemek serbest.
- Sürüm dalda ve entegrasyonda verilmez, yalnız teslimde: davranış değişikliği `packages/school-core/changes/<konu>.md` parçası yazar; iç paketler `workspace:*`. README test sayıları yalnız teslimde. Üretilen dosyalar (`openapi.json`, `schema.d.ts`) elle birleştirilmez: `pnpm install && pnpm gen`.
- Push öncesi yalnız dokunulan paketlerin format/lint/typecheck ve ilgili birim/API testleri; tam set ve e2e CI'da. CI kırmızıysa kıran ilk iş düzeltir ya da geri alır (`git revert -m 1`). Küçük, mantıklı birim yeşil olunca hemen entegrasyona; uzun yaşayan dal yok.
- `push-kontrol` hook'u force push, `+refspec`, `main`'e push ve güncel entegrasyonu birleştirmeden ya da aynı numaralı migration'la entegrasyon dalına push'u engeller. Push reddedilirse: fetch, merge, test, yeniden push; geçmiş yeniden yazılmaz.
