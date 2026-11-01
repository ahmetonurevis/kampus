# Oğuzhan'ın görev tablosu

- Bu dosyayı yalnız Oğuzhan düzenler. Onur'un tablosu [onur.md](onur.md); sahiplik, sözleşmeler ve bağımlılıklar [README](README.md)'dedir.
- Her dalga (D1–D5, Sonra) bir tablodur. Sıradaki iş önce dalgaya, sonra bağımlılığa göre seçilir; dalga içinde konu sırası serbesttir. Karşı tarafı bekleyen iş durmaz, geçici veriyle sürer.
- **ID** kalıcıdır (`OG-001`…). Yeni görev ilgili dalga tablosunun sonuna, dosyadaki en büyük numaradan sonraki numarayla eklenir. Numara yeniden verilmez; vazgeçilen görev silinmez, `iptal` olur.
- **Durum** yalnız şunlardan biridir: `bekliyor`, `çalışılıyor`, `revizyon` (bitmişti; inceleme, karşı taraf ya da kullanıcı düzeltme istedi), `engelli` (Not'ta beklenen görev ID'si), `bitti`, `iptal`.
- **Dal / commit:** `çalışılıyor` ve `revizyon`da dal adı, `bitti`de entegrasyondaki birleştirme commit'inin kısa hash'i. **Not:** bağımlılık ya da engel ("ON-014 bekleniyor"), revizyon gerekçesi ya da `#issue`, migration ve ADR numarası.
- Durumu oturum yazar: başlarken `is-baslat` (`çalışılıyor`), birleştirince `entegre-et` (`bitti`). Değişiklik entegrasyon dalında küçük bir commit'tir: "Görev durumunu güncelle: OG-012 çalışılıyor". Kurallar: [.claude/rules/ortak-calisma.md](../../.claude/rules/ortak-calisma.md).
- Görev boyu bir dalda 1–3 commit'lik, kendi başına birleştirilebilir iştir. IST kimliği görev metnindedir.

## D1 · Temel

| ID     | Görev                                                                                                                                                                                             | Durum       | Dal / commit                   | Not                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------ | ---------------------------------------------- |
| OG-001 | Ortak çalışma kuralları, kancalar ve görev tablosu durum sistemi                                                                                                                                  | çalışılıyor | `oguzhan/is-bolumu-belgesi`    |                                                |
| OG-002 | Onur'un kayıt ve finans dalını birleştir, migration 0016–0022 ile tam doğrula; veli kuralı: okulda her yaşta zorunlu, dil okulunda 18 yaş üstü velisiz (kullanıcı kararı, 2 Kasım) (IST-019, 091) | çalışılıyor | `merge/onur-kayit-finans`      | İnceleme ON-001                                |
| OG-003 | Bildirim merkezi: core, uçlar, kancalar ve uygulama içi kanal (IST-065)                                                                                                                           | çalışılıyor | `feature/bildirim-merkezi`     |                                                |
| OG-004 | Görev görünüm uçları: öğrenci ilerleme özeti, `actionableUntil` (IST-034, 057)                                                                                                                    | çalışılıyor | `feature/gorev-gorunum-uclari` |                                                |
| OG-005 | Dosya kaydı takipleri: indirme belirteci, ret sonrası yeniden deneme (IST-027)                                                                                                                    | çalışılıyor | `feature/takip-dosya-kayit`    |                                                |
| OG-006 | Koordinatör görevi ve son puan uçları (IST-005, 048)                                                                                                                                              | çalışılıyor | `feature/koordinator-son-puan` |                                                |
| OG-007 | Maskeli veli iletişimi (IST-070, 028)                                                                                                                                                             | çalışılıyor | `cloud/kv1-veli-iletisim`      |                                                |
| OG-008 | Ortak sıcak dosyaları böl (1/4): `page-registry` ve `page-coverage` alan dosyalarına                                                                                                              | bekliyor    |                                | Amaç iki tarafın aynı dosyaya yazmaması        |
| OG-009 | Ortak sıcak dosyaları böl (2/4): `modules/commands` ve `full-navigation` alan dosyalarına                                                                                                         | bekliyor    |                                |                                                |
| OG-010 | Ortak sıcak dosyaları böl (3/4): `app.ts` rota kaydı, `authorize` ve `scope` eylem tabloları alan bloklarına (IST-004)                                                                            | bekliyor    |                                |                                                |
| OG-011 | Ortak sıcak dosyaları böl (4/4): `data/seed`, `commands.test` envanteri ve `docs/sayfalar.md`                                                                                                     | bekliyor    |                                |                                                |
| OG-012 | CI'yı hızlandır: `checks.yml` işlerini paralel böl, `concurrency` ile eski koşuyu iptal et, 15 dk aşımını gider                                                                                   | bekliyor    |                                |                                                |
| OG-013 | `lib/pdf/templates.ts`'i `lib/pdf/templates/<alan>.ts` dosyalarına böl                                                                                                                            | bekliyor    |                                | Onur'un PDF işlerinden önce: ON-019            |
| OG-014 | Taze oturum: `requireFreshSession` ve `<ReauthModal>` platforma                                                                                                                                   | bekliyor    |                                | Onur'un iade ve tahsilat iptali kullanır       |
| OG-015 | Aydınlatma ve rıza: core modeli ve migration (IST-016, 017)                                                                                                                                       | bekliyor    |                                |                                                |
| OG-016 | Rıza uçları: `GET /privacy-notices/:purpose`, `POST /consents`, geri çekme (IST-016, 017)                                                                                                         | bekliyor    |                                | Onur'u bekletir: ON-025, ON-008                |
| OG-017 | `<ConsentStep>` ve `useConsents` (IST-016, 017)                                                                                                                                                   | bekliyor    |                                | Onur'u bekletir: ON-025                        |
| OG-018 | `notify(tx, …)` servisi ve alan başına bildirim türü dosyası (IST-065)                                                                                                                            | bekliyor    |                                | Onur'u bekletir: ON-026, ON-027                |
| OG-019 | Web bildirim listesi ve okunmamış rozeti (IST-065)                                                                                                                                                | bekliyor    |                                | OG-003 sonrası                                 |
| OG-020 | Bildirim ifade indeksi migration'ı (`TODO(F6-bildirim-indeksi)`) (IST-065)                                                                                                                        | bekliyor    |                                |                                                |
| OG-021 | Son puan ve itiraz kararında `feedback_released` bildirimi (IST-065, 048)                                                                                                                         | bekliyor    |                                | OG-006 ve OG-003 sonrası                       |
| OG-022 | Okuma uçlarında modül denetimiyle sorgu doğrulamasının sırasını tara (400/403) (IST-009)                                                                                                          | bekliyor    |                                |                                                |
| OG-023 | Akademik yıl ve dönem uçları, `GET /academic-years` (IST-011)                                                                                                                                     | bekliyor    |                                | Onur'un tarifesi kullanır                      |
| OG-024 | Akademik yıl ve dönem ayar ekranı (IST-011)                                                                                                                                                       | bekliyor    |                                |                                                |
| OG-025 | Pano kart yuvası, `dashboard-cards` (IST-116)                                                                                                                                                     | bekliyor    |                                | Onur'u bekletir: ON-032                        |
| OG-026 | Ayar sekme yuvası, `settings-sections`                                                                                                                                                            | bekliyor    |                                | Onur'u bekletir: ON-033                        |
| OG-027 | `authorize` eylem tablosunda Onur bloğu, yetki eylem blokları (IST-004)                                                                                                                           | bekliyor    |                                |                                                |
| OG-028 | Kur ve program tanımı: core ve API, `GET /courses` (IST-076)                                                                                                                                      | bekliyor    |                                | Onur'un paket satışı kullanır: ON-058          |
| OG-029 | Grup açma ve planlama: core ve API, `GET /groups`, çakışma denetimi (IST-077)                                                                                                                     | bekliyor    |                                |                                                |
| OG-030 | Kur ve grup web ekranları (IST-076, 077)                                                                                                                                                          | bekliyor    |                                |                                                |
| OG-031 | Veli–öğrenci bağı servisi `linkGuardian`, velayet ve iletişim kısıtı (IST-019)                                                                                                                    | bekliyor    |                                | Onur'un kesin kaydı kullanır: ON-010           |
| OG-032 | Velayet kısıtını okuma kapsamına uygula (`TODO(velayet-kapsam)`) (IST-019)                                                                                                                        | bekliyor    |                                |                                                |
| OG-033 | Kurum türünü genişlet: `kurs` (üniversite hazırlık, KPSS akademisi); terminoloji, seviye modeli, varsayılan modüller, 18 yaş üstü velisiz kayıt (IST-001)                                         | bekliyor    |                                | Kullanıcı kararı, 2 Kasım                      |
| OG-034 | Çapraz kurum erişim testlerini bütün uçlara yay (IST-002)                                                                                                                                         | bekliyor    |                                |                                                |
| OG-035 | Parola sıfırlama ve oturum yenileme; demo rol seçiciyi kaldır (IST-003)                                                                                                                           | bekliyor    |                                |                                                |
| OG-036 | Kapalı modülde kalan uçları ve route'ları kapat (IST-009)                                                                                                                                         | bekliyor    |                                |                                                |
| OG-037 | Denetim kaydına işlemi yapan kullanıcıyı yaz (`TODO(core-audit-user)`) (IST-014)                                                                                                                  | bekliyor    |                                |                                                |
| OG-038 | Kampüs, sınıf ve kadro ekranlarının kalanları; dolu arşiv senaryosu (IST-010)                                                                                                                     | bekliyor    |                                |                                                |
| OG-039 | Ders programı yazma, yedek öğretmen ve ders iptal ucu (IST-094)                                                                                                                                   | bekliyor    |                                |                                                |
| OG-040 | Ders programı ve yedek görevlendirme web ekranı (IST-094)                                                                                                                                         | bekliyor    |                                |                                                |
| OG-041 | Yönetici yoklama düzeltme sayfası, gerekçe zorunlu (IST-093)                                                                                                                                      | bekliyor    |                                |                                                |
| OG-042 | Yoklamada geç gelme, toplu işaretleme ve tarih aralığı (IST-093)                                                                                                                                  | bekliyor    |                                |                                                |
| OG-043 | Anlık devamsızlık bildirimi (IST-072)                                                                                                                                                             | bekliyor    |                                | OG-018 sonrası                                 |
| OG-044 | Mazeret onayı, dosyası ve KVKK notu (`TODO(absence-approval)`, `absence-files`, `kvkk-mazeret-notu`) (IST-072)                                                                                    | bekliyor    |                                |                                                |
| OG-045 | Ödev oluşturma ve teslim uçları (`TODO(api-homework-write)`, `api-homework-submit`) (IST-095)                                                                                                     | bekliyor    |                                |                                                |
| OG-046 | Quiz oluşturma, çözme ve sunucu puanlaması (`TODO(api-quiz-write)`, `api-quiz-submit`, `api-quiz-grading`) (IST-095)                                                                              | bekliyor    |                                |                                                |
| OG-047 | Ödev ve quiz web yazma ekranları (IST-095)                                                                                                                                                        | bekliyor    |                                |                                                |
| OG-048 | Dosyalı teslim ve konuşma ses kaydı: core ve API (IST-051, 126)                                                                                                                                   | bekliyor    |                                |                                                |
| OG-049 | Dinleme hakkı sayımı, `attempt_media_plays` (`TODO(F4b4-listening)`) (IST-045)                                                                                                                    | bekliyor    |                                |                                                |
| OG-050 | Konuşma görevi web ekranı: tarayıcıda ses kaydı, hazırlık ve süre sınırı (IST-051)                                                                                                                | bekliyor    |                                |                                                |
| OG-051 | Okuma-anlama etkinliği ekranı: seviyeli metin, sözlükçe, alt beceri soruları (IST-042)                                                                                                            | bekliyor    |                                |                                                |
| OG-052 | Dinleme etkinliği ekranı: dinleme sınırı ve transkript ayarı (IST-045)                                                                                                                            | bekliyor    |                                |                                                |
| OG-053 | CEFR tabloları: `placement_sessions`, `level_decisions`, `progression_decisions` (IST-058, 060, 062)                                                                                              | bekliyor    |                                |                                                |
| OG-054 | CEFR uçları: seviye tespiti ve profil okuma (`TODO(api-cefr-progress)`) (IST-058, 060)                                                                                                            | bekliyor    |                                |                                                |
| OG-055 | Dijital veli onayı: core ve API, son tarih (IST-067)                                                                                                                                              | bekliyor    |                                |                                                |
| OG-056 | Dijital veli onayı web ekranı ve hatırlatma (IST-067)                                                                                                                                             | bekliyor    |                                |                                                |
| OG-057 | Yönetici koordinatör görevi atama ekranı (IST-005)                                                                                                                                                | bekliyor    |                                |                                                |
| OG-058 | Koordinatör uyuşmazlık kuyruğu ve son puan penceresi; `docs/sayfalar.md` (IST-005, 048)                                                                                                           | bekliyor    |                                |                                                |
| OG-059 | Branş değişince koordinatör kapsamını güncelle (DOM-YTK-027) (IST-005)                                                                                                                            | bekliyor    |                                | Kesiştirme ya da arşiv seçimi kullanıcı kararı |
| OG-060 | Personel daveti ve toplu personel aktarımı (IST-007)                                                                                                                                              | bekliyor    |                                | Öğrenci ve veli aktarımı Onur'da: ON-060       |
| OG-061 | Mobil öğrenci akışları API'ye (IST-124)                                                                                                                                                           | bekliyor    |                                |                                                |
| OG-062 | Mobil öğretmen akışları API'ye (IST-124)                                                                                                                                                          | bekliyor    |                                |                                                |
| OG-063 | Mobil veli akışları API'ye (IST-124)                                                                                                                                                              | bekliyor    |                                |                                                |
| OG-064 | Mobil bildirim listesi ve ses kaydı yükleme (IST-065, 126)                                                                                                                                        | bekliyor    |                                |                                                |
| OG-065 | `use-management-commands` ve `module-settings` kancalarında `requireIfMatch`                                                                                                                      | bekliyor    |                                |                                                |
| OG-066 | Liste arama metninin URL'e yazılması (KVKK): kural ya da ADR ve uygulama (`TODO(liste-arama-url)`) (IST-028)                                                                                      | bekliyor    |                                |                                                |
| OG-067 | İçerik havuzu kalanları: kütüphane ve öğrenme çıktısı (`TODO(F3b-library)`, `F3b-outcomes`) (IST-030, 031)                                                                                        | bekliyor    |                                |                                                |
| OG-068 | Soru bankası yazma ekranı, altı soru türü (IST-033)                                                                                                                                               | bekliyor    |                                |                                                |
| OG-069 | İçerik aramasında seviye süzgeci (`TODO(api-filter-level)`) (IST-035)                                                                                                                             | bekliyor    |                                |                                                |
| OG-070 | Telif bildirimli ya da kaldırılmış kaynağı deneme ve teslim uçlarında süz (DOM-KYN-025) (IST-036)                                                                                                 | bekliyor    |                                |                                                |

Ara nokta: ilk sözleşme paketi iki tarafta da kullanılabilir (rıza, bildirim, finans özeti, öğrenci bakiyesi, akademik yıl, kur ve grup).

## D2 · İlk yayın

| ID     | Görev                                                                                                            | Durum    | Dal / commit | Not                              |
| ------ | ---------------------------------------------------------------------------------------------------------------- | -------- | ------------ | -------------------------------- |
| OG-071 | React–Vue sayfa eşitliği denetim listesi, Oğuzhan'ın alanı                                                       | bekliyor |              |                                  |
| OG-072 | Vue uygulamasını sil, `apps/web-react` → `apps/web`; README ve belgeler                                          | bekliyor |              | OG-071, ON-035 ve ON-036 sonrası |
| OG-073 | Demo kalıcılığını sil: `stores/demo.js`, `demo-persistence.ts` (`TODO(demo-kalicilik)`) (IST-124)                | bekliyor |              |                                  |
| OG-074 | Mobil yalnız API'ye geçer, AsyncStorage snapshot'ı silinir (IST-124)                                             | bekliyor |              |                                  |
| OG-075 | Mobil kabuk rota sözleşmesi: kategoriye ekran kaydı, API kancaları (IST-124)                                     | bekliyor |              | Onur'u bekletir: ON-078, ON-041  |
| OG-076 | Akademik, beceri ve iletişim duman testleri                                                                      | bekliyor |              |                                  |
| OG-077 | Seviye tespit sınavı: otomatik bölümler, puanlanan yazma ve konuşma (IST-058)                                    | bekliyor |              |                                  |
| OG-078 | Seviye tespit sınavı web ekranı (IST-058)                                                                        | bekliyor |              |                                  |
| OG-079 | Beceri bazlı CEFR profili ve zaman çizelgesi ekranı (IST-060)                                                    | bekliyor |              |                                  |
| OG-080 | Beceri ilerleme panosu (IST-057)                                                                                 | bekliyor |              |                                  |
| OG-081 | Yazma görevi taslak döngüsü: otomatik taslak, yeniden teslim (IST-047)                                           | bekliyor |              |                                  |
| OG-082 | Yazma görevi web ekranı (IST-047)                                                                                | bekliyor |              |                                  |
| OG-083 | Rubrik kütüphanesi ve rubrikli puanlama ekranı (IST-048)                                                         | bekliyor |              |                                  |
| OG-084 | Konuşma değerlendirmesi: kaydı dinleyip rubrikle puanlama, sesli geri bildirim (IST-052)                         | bekliyor |              |                                  |
| OG-085 | Ünite alıştırma seti: otomatik puan, anında geri bildirim, deneme hakkı (IST-056)                                | bekliyor |              |                                  |
| OG-086 | Kur sonu değerlendirme ve geçiş kararı: core ve API (IST-062)                                                    | bekliyor |              |                                  |
| OG-087 | Devam şartı izleme: kur bazında eşik, uyarı, "devamsızlıktan kaldı" önerisi (IST-080)                            | bekliyor |              |                                  |
| OG-088 | Kur bitirme belgesi PDF'i, doğrulama kodu ve QR (IST-081)                                                        | bekliyor |              |                                  |
| OG-089 | İçerikten etkinlik oluşturma ve atama ekranı (IST-034)                                                           | bekliyor |              |                                  |
| OG-090 | Özel nitelikli veri alanları ve dar yetki (`TODO(IST-020)`) (IST-020)                                            | bekliyor |              |                                  |
| OG-091 | Dosya deposu S3 sürücüsü (`TODO(F3c2-s3)`) (IST-027)                                                             | bekliyor |              |                                  |
| OG-092 | Dosya tarama işi ve ret yeniden denemesi (`TODO(F3c2-scan)`) (IST-027)                                           | bekliyor |              | OG-094 sonrası                   |
| OG-093 | Yetim nesne taraması, kota ve depoda şifreleme (`TODO(F3c2-orphans)`, `F3c2-quota`, `F3c2-encryption`) (IST-027) | bekliyor |              |                                  |
| OG-094 | Arka plan iş kuyruğu (`TODO(jobs)`), zamanlanmış işlerin temeli                                                  | bekliyor |              |                                  |
| OG-095 | E-posta kanalı: kurum adına gönderim, geri dönen adres takibi (IST-132)                                          | bekliyor |              |                                  |
| OG-096 | Parola politikası, hız sınırı, kilitleme, oturum listesi (IST-025)                                               | bekliyor |              |                                  |
| OG-097 | Veri işleme sözleşmesi şablonu ve alt işleyen listesi (IST-023)                                                  | bekliyor |              |                                  |
| OG-098 | Veli ve öğrenci ekranlarını dar ekranda eksiksiz yap (IST-127)                                                   | bekliyor |              |                                  |
| OG-099 | Pano kabuğu: akademik ve iletişim kartları (IST-116)                                                             | bekliyor |              | Finans kartları Onur'da: ON-032  |
| OG-100 | Beceri ve CEFR raporlarının ilk sürümü: sınıf ve kur ortalaması (IST-118)                                        | bekliyor |              |                                  |
| OG-101 | Sayım ve toplamları SQL'e taşı (`TODO(perf)`, `TODO(api-aggregate)`)                                             | bekliyor |              |                                  |
| OG-102 | İş akışı satırlarını sunucuda sayfala (`TODO(api-workflow-rows)`)                                                | bekliyor |              |                                  |
| OG-103 | Kayıt şemalarını core'dan API'ye bağla (`TODO(C2-record-schemas)`, `api-record-schemas`)                         | bekliyor |              |                                  |

Ara nokta: API'nin ilk yayını.

## D3 · Pilot okul

| ID     | Görev                                                                               | Durum    | Dal / commit | Not                                        |
| ------ | ----------------------------------------------------------------------------------- | -------- | ------------ | ------------------------------------------ |
| OG-104 | SMS sağlayıcı: onaylı başlık, teslim raporu, kurum kotası (IST-131)                 | bekliyor |              | Onur'u bekletir: ON-066                    |
| OG-105 | Push kaydı ve gönderimi, derin bağlantı (IST-125)                                   | bekliyor |              |                                            |
| OG-106 | Okunmayan kritik bildirimde kanal yükseltme (IST-073)                               | bekliyor |              |                                            |
| OG-107 | Bildirim tercihleri ve sessiz saat ekranı (`TODO(bildirim-tercihleri)`) (IST-065)   | bekliyor |              |                                            |
| OG-108 | İYS sorgusu: tanıtım iletisinden önce onay kontrolü (IST-135)                       | bekliyor |              |                                            |
| OG-109 | Seviye tespiti oturumu sözleşmesi, `POST /placement-sessions` (IST-058, 059)        | bekliyor |              | Onur'u bekletir: ON-076                    |
| OG-110 | Ek roller: müdür yardımcısı, rehber, muhasebe; core ve API (IST-006)                | bekliyor |              |                                            |
| OG-111 | Ek rollerin menüsü ve ekranları (IST-006)                                           | bekliyor |              | Muhasebe yetkileri: ON-069                 |
| OG-112 | PDF motorunu paylaşılan pakete al, mobil PDF (IST-013)                              | bekliyor |              | Onur'un mobil finans ekranları kullanır    |
| OG-113 | Aydınlatma metinlerinin sürümlü yayını, ilk girişte gösterim (IST-016)              | bekliyor |              |                                            |
| OG-114 | Çocuğa uygun aydınlatma: öğrenci rolüne sade metin (IST-018)                        | bekliyor |              |                                            |
| OG-115 | Kur geçiş kararı web ekranı ve `GET /level-decisions` (IST-062)                     | bekliyor |              | Onur'un kur yenilemesi kullanır: ON-082    |
| OG-116 | Ders saati özeti `GET /lesson-hours`, iptal ve telafiyle                            | bekliyor |              | Onur'un hakediş ve paket bakiyesi kullanır |
| OG-117 | Öğretim günleri (IST-011)                                                           | bekliyor |              | Onur'un iade gün sayımı kullanır           |
| OG-118 | Hedefli duyuru: kurum, kampüs, sınıf, rol; zamanlama, ek, okundu takibi (IST-066)   | bekliyor |              |                                            |
| OG-119 | Kurallı mesajın kalanı: sessiz saat, rol bazlı izin, arşiv (IST-070)                | bekliyor |              |                                            |
| OG-120 | Deneme sınavı ve optik değerlendirmeyi API'ye taşı (IST-096, 136)                   | bekliyor |              |                                            |
| OG-121 | Otomatik etüdü API'ye taşı (IST-096)                                                | bekliyor |              |                                            |
| OG-122 | Rehberlik dosyasını API'ye taşı, gizli not kapsamı (DOM-YTK-020) (IST-097)          | bekliyor |              |                                            |
| OG-123 | Hedef ve gelişim planını API'ye taşı (IST-098)                                      | bekliyor |              |                                            |
| OG-124 | Medya barındırma ve uyarlanabilir akış (IST-041)                                    | bekliyor |              |                                            |
| OG-125 | Mobilde kesintide yeniden deneyen yükleme, fotoğrafla ödev teslimi (IST-126)        | bekliyor |              |                                            |
| OG-126 | Pilot nöbeti: yoklama, görevler, veli bildirimi                                     | bekliyor |              |                                            |
| OG-127 | Platform ve KVKK "doğrulanmalı" notlarını hukukçu sorularına derle (`docs/domain/`) | bekliyor |              |                                            |

Ara nokta: pilot okul canlı.

## D4 · Mağaza ve yıl sonu

| ID     | Görev                                                                                                  | Durum    | Dal / commit | Not                     |
| ------ | ------------------------------------------------------------------------------------------------------ | -------- | ------------ | ----------------------- |
| OG-128 | Mağaza sürümünün içeriği: beş rol API'li, push açık (IST-124, 125)                                     | bekliyor |              |                         |
| OG-129 | Seviyeli okuma kitaplığı ve okuma günlüğü (IST-043)                                                    | bekliyor |              |                         |
| OG-130 | Kelime listeleri ve aralıklı tekrar (IST-055)                                                          | bekliyor |              |                         |
| OG-131 | İçerik onay akışı ve sürümleme; kaynak onayını koordinatöre bağla (`TODO(content-reviewer)`) (IST-037) | bekliyor |              |                         |
| OG-132 | Müfredat ve CEFR kataloğu içe aktarımı (`TODO(katalog)`) (IST-032)                                     | bekliyor |              |                         |
| OG-133 | İçerik kullanım analitiği (`TODO(content-report-log)`) (IST-038)                                       | bekliyor |              |                         |
| OG-134 | Saklama süreleri, periyodik imha işi ve tutanak (`TODO(F3c2-retention)`) (IST-021)                     | bekliyor |              |                         |
| OG-135 | İlgili kişi başvurusu: döküm, düzeltme ve silme takibi (IST-022)                                       | bekliyor |              | Kimlik okuma: ON-063    |
| OG-136 | İki adımlı doğrulama (IST-026)                                                                         | bekliyor |              |                         |
| OG-137 | Dışa aktarım yetkisi ve maskeleme (IST-028)                                                            | bekliyor |              |                         |
| OG-138 | Dönem gelişim raporu, uygulamada ve PDF (IST-074)                                                      | bekliyor |              |                         |
| OG-139 | Karne PDF'i, teşekkür ve takdir belgesi (DOM-AKD-053) (IST-074)                                        | bekliyor |              |                         |
| OG-140 | Sınıf geçme kararı ve `GET /year-end-results` (DOM-AKD-040, 050)                                       | bekliyor |              | Onur'u bekletir: ON-081 |
| OG-141 | Yılsonu sonuç itirazı (DOM-AKD-053)                                                                    | bekliyor |              |                         |
| OG-142 | e-Okul not ve devamsızlık şablonu (IST-134)                                                            | bekliyor |              |                         |
| OG-143 | Bekleme listesi ve açılış kararı (IST-086)                                                             | bekliyor |              |                         |
| OG-144 | Birebir ve özel ders planlama, geç iptal kuralı (IST-083)                                              | bekliyor |              | Paket bakiyesi: ON-074  |
| OG-145 | Telafi oturumu ve grup değişikliği (IST-084)                                                           | bekliyor |              |                         |
| OG-146 | Dil okulu pilotu: kur, grup, devam, seviye tespiti, kur sonu kararı                                    | bekliyor |              |                         |
| OG-147 | Beceri ve CEFR raporları: öğretmen kırılımı ve dönem karşılaştırması (IST-118)                         | bekliyor |              |                         |
| OG-148 | Kurum kaynağı kullanım göstergesi (IST-123)                                                            | bekliyor |              |                         |
| OG-149 | Kazanım ve öğrenme çıktısı raporu, etüt ve ödev önerisi (IST-119)                                      | bekliyor |              |                         |
| OG-150 | Çalışma planını API'ye taşı (IST-098)                                                                  | bekliyor |              |                         |
| OG-151 | Erken uyarı risk listesi (`TODO(api-risk-listesi)`) (IST-121)                                          | bekliyor |              | Ödeme gecikmesi: ON-012 |
| OG-152 | Öğretmen yanıt süresi ve iş yükü raporu (`TODO(api-sla-aggregate)`) (IST-120)                          | bekliyor |              |                         |
| OG-153 | Zamanlanmış rapor e-postası, CSV ve PDF (IST-122)                                                      | bekliyor |              |                         |
| OG-154 | Sınıf içi hızlı beceri değerlendirmesi (IST-053)                                                       | bekliyor |              |                         |
| OG-155 | Sesli okuma kaydı ve akıcılık rubriği (IST-044)                                                        | bekliyor |              |                         |
| OG-156 | Satır içi düzeltme ve hata kodları (IST-049)                                                           | bekliyor |              |                         |
| OG-157 | Can-do öz değerlendirme (IST-061)                                                                      | bekliyor |              |                         |
| OG-158 | Okulda İngilizce için CEFR'e paralel izleme (IST-063)                                                  | bekliyor |              |                         |

Ara nokta: Android mağaza sürümü; dil okulu pilotu canlı; yıl sonu işlemleri çalıştı.

## D5 · Yeni öğretim yılı

| ID     | Görev                                                                           | Durum    | Dal / commit | Not |
| ------ | ------------------------------------------------------------------------------- | -------- | ------------ | --- |
| OG-159 | Akademik açılış: sınıf, şube, kadro ataması, ders programı (IST-010, 094)       | bekliyor |              |     |
| OG-160 | Çoklu rol ve çoklu kurum (IST-008)                                              | bekliyor |              |     |
| OG-161 | İngilizce arayüz (IST-015)                                                      | bekliyor |              |     |
| OG-162 | Kurum markası ve belge başlığı (IST-013)                                        | bekliyor |              |     |
| OG-163 | Sınıf ve kur bülteni (IST-068)                                                  | bekliyor |              |     |
| OG-164 | Anket ve memnuniyet (IST-069)                                                   | bekliyor |              |     |
| OG-165 | Veli görüşmesi ve veli günü planlama (IST-071)                                  | bekliyor |              |     |
| OG-166 | Öğretmen hızlı işlemleri mobilde: yoklama, hızlı rubrik, mesaj yanıtı (IST-129) | bekliyor |              |     |
| OG-167 | iOS uygulaması (IST-128)                                                        | bekliyor |              |     |
| OG-168 | Erişilebilirlik ve performans geçişi                                            | bekliyor |              |     |
| OG-169 | Açılış nöbeti: ders programı, yoklama, görev atama                              | bekliyor |              |     |

Ara nokta: yeni öğretim yılı açıldı; pilot okul tam yıl, dil okulu ve yeni kurumlar canlı. Faz 2 kapandı.

## Sonra · Faz 3

| ID     | Görev                                                     | Durum    | Dal / commit | Not |
| ------ | --------------------------------------------------------- | -------- | ------------ | --- |
| OG-170 | Otomatik yazma ve konuşma geri bildirimi ADR'si (IST-054) | bekliyor |              |     |
| OG-171 | Dikte (IST-046)                                           | bekliyor |              |     |
| OG-172 | Akran değerlendirmesi (IST-050)                           | bekliyor |              |     |
| OG-173 | Uluslararası sınav kayıtları (IST-064)                    | bekliyor |              |     |
| OG-174 | Kurumlar arası ortak kütüphane (IST-039)                  | bekliyor |              |     |
| OG-175 | H5P, QTI ve SCORM içe aktarma (IST-040)                   | bekliyor |              |     |
| OG-176 | Mesaj çevirisi (IST-075)                                  | bekliyor |              |     |
| OG-177 | Çevrimiçi ders bağlantısı (IST-090)                       | bekliyor |              |     |
| OG-178 | Davranış ve olumlu davranış takibi (IST-101)              | bekliyor |              |     |
| OG-179 | Zayıf bağlantıda içerik önbelleği (IST-130)               | bekliyor |              |     |
| OG-180 | Takvim aboneliği, iCal (IST-137)                          | bekliyor |              |     |
| OG-181 | Kurumsal hesapla giriş: Google, Microsoft (IST-138)       | bekliyor |              |     |
| OG-182 | LTI 1.3 ve yayınevi bağlantısı (IST-139)                  | bekliyor |              |     |
| OG-183 | Açık API ve webhook (IST-140)                             | bekliyor |              |     |

## Karar çıkana kadar bende

Ek küme A (yayın, işletim, kurum kurulumu) ve B (ön büro, okul yaşamı) Onur'a önerildi; karar ON-002 ile çıkar. Kabul edilen satır Onur'un tablosundaki karşılığına geçer, buradaki `iptal` olur. Not sütunu işin dalgasını gösterir.

| ID     | Görev                                                                                        | Durum    | Dal / commit | Not                      |
| ------ | -------------------------------------------------------------------------------------------- | -------- | ------------ | ------------------------ |
| OG-184 | (öneri A) Sunucu, PostgreSQL yedeği, TLS, alan adı, dağıtım betiği ve yayın ADR'si (IST-024) | bekliyor |              | D2 · karşılığı ON-053    |
| OG-185 | (öneri A) İzleme, log ve geri dönüş provası (IST-024)                                        | bekliyor |              | D2 · karşılığı ON-054    |
| OG-186 | (öneri A) Güvenlik olayı ve ihlal kaydı (IST-029)                                            | bekliyor |              | D3 · karşılığı ON-070    |
| OG-187 | (öneri A) Pilot ortamı                                                                       | bekliyor |              | D3 · karşılığı ON-071    |
| OG-188 | (öneri A) Android derleme, imza ve Play yayını (IST-124, 128 yayın kısmı)                    | bekliyor |              | D4 · karşılığı ON-088    |
| OG-189 | (öneri A) Operatör paneli ve yeni kurum kurulum aracı (IST-012)                              | bekliyor |              | D5 · karşılığı ON-096    |
| OG-190 | (öneri A) Yük testi, yedekten geri dönüş provası, yeni kurumların kurulumu                   | bekliyor |              | D5 · karşılığı ON-097    |
| OG-191 | (öneri B) Talep ve şikayet, `requests.ts` ayrımı                                             | bekliyor |              | D4 · karşılığı ON-089    |
| OG-192 | (öneri B) Okul yaşamını API'ye taşı: takvim, servis, yemek, kulüp (IST-099)                  | bekliyor |              | D4 · karşılığı ON-090    |
| OG-193 | (öneri B) Giriş-çıkış ve teslim yetkisi (IST-103)                                            | bekliyor |              | D4 · karşılığı ON-091    |
| OG-194 | (öneri B) Servis güzergâhları ve kulüp kayıtları (IST-099)                                   | bekliyor |              | D5 · karşılığı ON-098    |
| OG-195 | (öneri B) Revir ve ilaç onayı (IST-102)                                                      | bekliyor |              | Faz 3 · karşılığı ON-101 |
