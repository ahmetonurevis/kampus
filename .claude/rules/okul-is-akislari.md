---
paths:
  - 'packages/school-core/src/modules/school-workflows.ts'
  - 'packages/school-core/src/modules/collection-modules.ts'
  - 'packages/school-core/src/data/school-workflows.ts'
  - 'packages/school-core/src/lib/school-workflows.ts'
  - 'packages/school-core/src/lib/workflow-presentation.ts'
  - 'packages/school-core/src/lib/assessment-automation.ts'
  - 'packages/school-core/src/lib/delimited-input.ts'
  - 'packages/school-core/src/lib/tutor-conflicts.ts'
  - 'packages/school-core/src/lib/school-management.ts'
  - 'packages/school-core/src/platform/**'
  - 'packages/react-shared/src/*workflow*'
  - 'packages/react-shared/src/*assessment*'
  - 'packages/react-shared/src/*tutoring*'
  - 'apps/api/src/routes/workflows.schemas.ts'
  - 'apps/api/src/routes/assessment*.ts'
  - 'apps/api/src/services/assessment.ts'
  - 'apps/web-react/src/pages/workflows/**'
  - 'apps/web-react/src/pages/assessment/**'
  - 'apps/web-react/src/pages/academic/**'
  - 'apps/mobile/src/screens/WorkflowScreen.tsx'
  - 'apps/mobile/src/screens/OpticalScreen.tsx'
  - 'apps/mobile/src/screens/TutoringScreen.tsx'
  - 'apps/mobile/src/ui/Workflow*.tsx'
  - 'docs/domain/akademik-olcme.md'
  - 'docs/okul-is-akislari.md'
  - 'docs/hedef-gelisim-plani.md'
  - 'docs/optik-degerlendirme-etut.md'
  - 'docs/optik-etut-plani.md'
---

# Okul iş akışları ve iş kuralları

Okul iş akışı, optik/etüt ve hedef modüllerine dokunulduğunda yüklenir. Alan kuralları `docs/domain/`, kullanım belgeleri `docs/okul-is-akislari.md`, `docs/hedef-gelisim-plani.md`, `docs/optik-degerlendirme-etut.md`.

- Okul iş akışı modülleri web, mobil ve API'de aynı `school-core` tanımlarını kullanır: `modules/school-workflows.ts` modül kaydı, `lib/school-workflows.ts` Zod doğrulaması, rol kapsamı ve atomik işlemler, `lib/workflow-presentation.ts` ortak liste/form/detay tanımları. Menü `modules/full-navigation.ts` ile paylaşılır. Mobil karşılıklar `WorkflowScreen.tsx`, `OpticalScreen.tsx`, `TutoringScreen.tsx`.
- İşlemler atomiktir: önce kalıcı yazılır, sonra state değişir; başarısızlıkta hiçbir kayıt değişmez. Snapshot sürümü 3 ve eski kayıtlar demo kalıcılığı silinene kadar korunur.
- Yenileme planlama ve sınıf geçişi ayrı işlemlerdir. Sözleşme `invoiceIds` ile yalnızca kendi taksitlerini çözümler. Rehberlik iç notlarını yalnız rehberlik görevli öğretmen görür; yönetici, ön büro, veli ve öğrenci görmez (DOM-YTK-020). İptal dersleri günlük programlarda görünmez.
- Optik/etüt doğrulaması `lib/assessment-automation.ts`, CSV ayrıştırması `lib/delimited-input.ts`, rezervasyon çakışmaları `lib/tutor-conflicts.ts` içindedir. Okuyucu CSV/DAT/TXT çıktısı kullanılır; cevap anahtarının her sorusu ders/kazanıma bağlıdır. Anahtar revizyonu veya manuel sonuç değişikliği eski optik analizin kullanımını engeller.
- Etütler öğretmen uygunluk saatlerini kullanır; kampüs/düzey/ders/kazanım grupları kapasite ve zaman çakışmalarıyla yerleştirilir. Önizleme saf işlemdir; son onay güncel planı yeniden hesaplar. İptal/yoklama geçmişi korunur; öğrenci/veli etüt verisi kendi kapsamına daraltılır.
- Hedef & gelişim planı (`goals`, `studentGoals`): ilerleme deneme sonuçlarından hesaplanır, saklanmaz. Öğrenci hedefi `Onay bekliyor` açar; yönetici/branş öğretmeni onaylar veya gerekçeyle reddeder; veli yalnızca yorum ekler. Aynı öğrenci ve kapsam için tek açık hedef bulunur. Kullanım: `docs/hedef-gelisim-plani.md`.
- Gelecek etüt rezervasyonu modül kapanınca kaybolmaz; çakışan ders/randevu/etkinlik ve bağlı kaydın arşivi engellenir. Dönem geçişinden önce öğrencinin ileri tarihli etütleri iptal edilir. Kullanım: `docs/optik-degerlendirme-etut.md`.
- Kampüs/sınıf/kadro arşivinde bağlı kayıtlar güvenli aktarılır; geçmiş finans/not/yoklama korunur. Yetersiz kontenjan, branş ve program çakışmaları engellenir. Arşivden geri almak aktarılan görevleri otomatik geri taşımaz.
