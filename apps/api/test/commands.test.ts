import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'

import { insertMissingRecords } from '../src/db/records.ts'
import { feeTariffs, priceIndexRates } from '../src/db/schema/fee-tariffs.ts'
import { FIXED_NOW } from './support/app.ts'
import {
  app,
  assertError,
  count,
  db,
  institution,
  post,
  useCommandsHarness,
} from './support/commands-harness.ts'
import { PLATFORM_IDEMPOTENT_ENDPOINTS } from './support/platform-idempotency.ts'

/**
 * Yazma uçlarının ortak testleri (api-tasarimi.md §1, §6, §7): Onur'un kayıt ve finans testleri
 * (`// Onur: kayıt ve finans` blokları) ve Idempotency-Key envanteri. Oğuzhan'ın uç testleri
 * `platform-commands.test.ts`'te, ortak donanım `support/commands-harness.ts`'tedir; Oğuzhan'ın
 * envanter girdileri `support/platform-idempotency.ts`'tedir (bir uç iki listede bulunamaz).
 */

// Onur: kayıt ve finans
/** Idempotency-Key başlığı zorunlu kayıt ve finans uçları (yeni satır bloğun sonuna). */
const ONUR_IDEMPOTENT_ENDPOINTS = [
  // Aday oluşturma (routes/prospects.ts; DOM-KAY-002).
  'POST /api/v1/prospects',
  // Kesin kayıt borç doğurur (routes/prospects.ts; DOM-KAY-035).
  'POST /api/v1/prospects/{prospectId}/enroll',
  // Pilot verisi toplu aktarımı (IST-007; DOM-KAY-036, DOM-FIN-014).
  'POST /api/v1/prospects/student-imports',
  'POST /api/v1/finance/installment-imports',
  // e-Okul öğrenci listesi aktarımı (IST-134; DOM-KAY-042).
  'POST /api/v1/prospects/eokul-student-imports',
  // Tahsilat, iptal ve nakit ayarı (routes/payments.ts; DOM-FIN-031, DOM-FIN-033).
  'POST /api/v1/payments',
  'POST /api/v1/payments/{paymentId}/mebbis-record',
  'POST /api/v1/payments/{paymentId}/reverse',
  // Gün kapanışı ve yeniden açma (routes/finance-day-closings.ts; DOM-FIN-036).
  'POST /api/v1/finance/day-closings/{closingDate}/close',
  'POST /api/v1/finance/day-closings/{closingDate}/reopen',
  'PATCH /api/v1/payment-settings',
  'PATCH /api/v1/finance/export-profile',
  'POST /api/v1/bank-accounts',
  'DELETE /api/v1/bank-accounts/{bankAccountId}',
  // Ayrılış ve iade (routes/withdrawals.ts; DOM-FIN-041).
  'POST /api/v1/students/{studentId}/withdraw',
  'POST /api/v1/withdrawals/{withdrawalId}/pay-refund',
  // Tarifeye bağlı yenileme sözleşme ve taksit yazar (routes/finance-renewals.ts; DOM-FIN-002).
  'POST /api/v1/finance/renewals',
  // Paket satışı sözleşme ve taksit yazar (routes/finance-packages.ts; IST-078).
  'POST /api/v1/finance/package-sales',
  // Toplu yenileme planı öğrenci başına sözleşme ve taksit yazar (IST-105, ON-086).
  'POST /api/v1/finance/renewals/bulk-plan',
  // Sözleşme onayı ve ek protokol (routes/finance-contracts.ts; IST-092, DOM-FIN-010).
  'POST /api/v1/finance/contracts/{contractId}/signatory',
  'POST /api/v1/finance/contracts/{contractId}/approve',
  'POST /api/v1/finance/contracts/{contractId}/amendments',
  'POST /api/v1/finance/contracts/{contractId}/cancel-amendment',
  // e-Özel işareti ücret satırında tahsilatın MEBBİS işaretini yazar (routes/finance-e-ozel.ts; IST-085).
  'POST /api/v1/finance/e-ozel/items/{kind}/{sourceId}/record',
  // Toplu fatura taksitleri tek belgeye bağlar (routes/finance-corporate.ts; IST-089, DOM-FIN-060).
  'POST /api/v1/finance/corporate-invoices',
  // Burs fonu bağışı, ataması ve iptalleri para hareketidir (routes/finance-scholarship-funds.ts;
  // DOM-FIN-068, ON-259).
  'POST /api/v1/finance/scholarship-funds/{fundId}/donations',
  'POST /api/v1/finance/scholarship-funds/{fundId}/allocations',
  'POST /api/v1/finance/scholarship-funds/{fundId}/donations/{donationId}/cancel',
  'POST /api/v1/finance/scholarship-funds/{fundId}/allocations/{allocationId}/cancel',
  // Burs kesme taksit yazar, gerçek dışı beyanda iptal geri isteme alacağı açar
  // (routes/finance-scholarships.ts; DOM-FIN-025, ON-283).
  'POST /api/v1/finance/scholarship-awards/{awardId}/terminate',
  'POST /api/v1/finance/scholarship-awards/{awardId}/revoke',
  // Ücretsiz okutma kurul kararı ücreti kapatır, iade ödemesi para çıkışıdır (DOM-FIN-026, ON-284).
  'POST /api/v1/finance/free-tuition/rounds/{roundId}/board-meetings',
  'POST /api/v1/finance/free-tuition/awards/{awardId}/pay-refund',
  // Banka ekstresi toplu aktarımı ve eşleşme onayı tahsilat yazar (IST-115, DOM-FIN-069).
  'POST /api/v1/finance/bank-statement-imports',
  'POST /api/v1/finance/bank-transactions/{transactionId}/match',
  // Satın alma siparişi numaralı belge açar (routes/finance-purchase-orders.ts; DOM-FIN-073).
  'POST /api/v1/finance/purchase-orders',
  // Mal kabul gider gerçekleşeni yazar (routes/finance-purchase-receipts.ts; DOM-FIN-074).
  'POST /api/v1/finance/purchase-orders/{orderId}/receipts',
  // Tedarikçi faturası ödeme planı yazar, ödeme para hareketidir (routes/finance-supplier-ledger.ts;
  // DOM-FIN-076).
  'POST /api/v1/finance/supplier-invoices',
  'POST /api/v1/finance/supplier-payments',
  // Stok girişi, çıkışı ve transferi miktarı değiştirir; çift tıklama iki hareket açmaz
  // (routes/finance-inventory.ts; DOM-FIN-078).
  'POST /api/v1/finance/stock-entries',
  'POST /api/v1/finance/stock-issues',
  'POST /api/v1/finance/stock-transfers',
  // Materyal seti teslimi stok çıkışı yazar; çift tıklama ikinci teslim ve çıkış açmaz
  // (routes/finance-material-sets.ts; DOM-FIN-080).
  'POST /api/v1/finance/material-sets/{setId}/deliveries',
  // Sayıma kart okutma sayılan miktara ekler; çift gönderim iki kez saymaz
  // (routes/finance-stock-counts.ts; DOM-FIN-081).
  'POST /api/v1/finance/stock-counts/{countId}/scans',
  // Sarf talebi açma, depodan karşılama (stok çıkışı) ve satın almaya dönüştürme (numaralı talep
  // açar); çift tıklama ikinci kaydı açmaz (routes/finance-supply-requests.ts; DOM-FIN-091).
  'POST /api/v1/finance/supply-requests',
  'POST /api/v1/finance/supply-requests/{requestId}/fulfill',
  'POST /api/v1/finance/supply-requests/{requestId}/convert',
  // İade faturası ve iptal isteği taslağı; çift tıklama aynı iadeye iki belge açmaz
  // (routes/finance-refund-invoices.ts; DOM-FIN-096).
  'POST /api/v1/finance/refund-invoices',
  // Bağış kaydı makbuz numarası açar, iptali makbuzu geçersiz kılar; çift gönderim ikinci makbuzu
  // kesmez (routes/finance-donations.ts; DOM-FIN-097).
  'POST /api/v1/finance/donation-campaigns/{campaignId}/donations',
  'POST /api/v1/finance/donations/{donationId}/cancel',
  // Paydaş ve sponsorluk anlaşması açılışı; çift tıklama ikinci kayıt açmaz
  // (routes/finance-stakeholders.ts; DOM-FIN-102).
  'POST /api/v1/finance/stakeholders',
  'POST /api/v1/finance/stakeholders/{stakeholderId}/agreements',
  // Gezi ve etkinlik katılımı taksit açar, iptaller taksit kapatıp iade kaydı yazar, iade ödemesi
  // para çıkışıdır (routes/finance-paid-activities.ts; DOM-FIN-098).
  'POST /api/v1/finance/paid-activities/{activityId}/cancel',
  'POST /api/v1/finance/paid-activities/{activityId}/participants',
  'POST /api/v1/finance/paid-activity-participants/{participantId}/cancel',
  'POST /api/v1/finance/paid-activity-participants/{participantId}/pay-refund',
  // Toplu katılım, izin kaydı ve formdan eşitleme taksit açar; izin geri çekilmesi katılımı iptal
  // eder (routes/finance-paid-activities.ts; DOM-FIN-112, ON-156).
  'POST /api/v1/finance/paid-activities/{activityId}/participants/bulk',
  'POST /api/v1/finance/paid-activities/{activityId}/consents/sync',
  'POST /api/v1/finance/paid-activity-participants/{participantId}/consent',
  'POST /api/v1/finance/paid-activity-participants/{participantId}/consent-withdraw',
  // Ayrılıştan kalan katılımların toplu iptali yedek geçirip taksit açar; çift gönderim ikinci
  // denetim izi yazmaz (routes/finance-paid-activities.ts; DOM-FIN-112, ON-347).
  'POST /api/v1/finance/paid-activity-participants/withdrawn-leftovers/cancel',
  // Mezun belge talebi ücreti dondurur ve dosya bağlar; çift tıklama ikinci talep açmaz
  // (routes/enrollment-alumni-documents.ts; DOM-KAY-044, ON-260).
  'POST /api/v1/prospects/alumni-document-requests',
  // Etkinlik bileti ayırma, ödeme işareti ve iptal (iade); çift tıklama ikinci bileti, ödemeyi ya da
  // iadeyi yazmaz (routes/finance-event-tickets.ts; DOM-FIN-103, ON-159).
  'POST /api/v1/finance/ticketed-events/{eventId}/tickets',
  'POST /api/v1/finance/event-tickets/{ticketId}/pay',
  'POST /api/v1/finance/event-tickets/{ticketId}/cancel',
  // Personel avansı taksit planı oluşturur; çift tıklama ikinci avansı açmaz
  // (routes/finance-staff-deductions.ts; DOM-FIN-101, ON-199).
  'POST /api/v1/finance/staff-advances',
  // Personel belgesi yıl bazlı numara keser; çift tıklama ikinci belge açmaz
  // (routes/finance-staff-certificates.ts; DOM-FIN-106).
  'POST /api/v1/finance/staff-certificates',
  // Etkinlik bileti iadesinin ödendiği işareti ve girişi geri alma; çift tıklama ikinci iade ya da
  // ikinci geri alma izi yazmaz (routes/finance-event-tickets.ts; DOM-FIN-103, ON-345).
  'POST /api/v1/finance/event-tickets/{ticketId}/refund',
  'POST /api/v1/finance/event-tickets/{ticketId}/undo-check-in',
  // Sağlık raporu girişi ve iptali; çift tıklama ikinci raporu (çakışma) ya da ikinci iptali
  // yazmaz (routes/finance-medical-reports.ts; DOM-FIN-110, ON-185).
  'POST /api/v1/finance/medical-reports',
  'POST /api/v1/finance/medical-reports/{reportId}/cancel',
  // Bordro ayının onayı ve yeniden açılması kilidi değiştirir; düzeltme kaydı sonraki aya bordro
  // girdisi yazar, iptali onu geri alır; çift tıklama ikinci kaydı açmaz
  // (routes/finance-payroll-periods.ts; DOM-FIN-108, ON-200).
  'POST /api/v1/finance/payroll-periods/{month}/approve',
  'POST /api/v1/finance/payroll-periods/{month}/reopen',
  'POST /api/v1/finance/payroll-periods/{month}/adjustments',
  'POST /api/v1/finance/payroll-adjustments/{adjustmentId}/cancel',
  // Kullanılmış izin kaydı yıllık izin bakiyesinden düşer; çift gönderim izni iki kez düşmez
  // (routes/finance-staff-leave.ts; DOM-FIN-109, ON-181).
  'POST /api/v1/finance/leave-records',
  // Onaylanan izin talebi kullanılmış izin kaydı üretir; talep ve onayın çift gönderimi izni iki
  // kez düşmez (routes/finance-leave-requests.ts; DOM-FIN-116, ON-182).
  'POST /api/v1/finance/leave-requests',
  'POST /api/v1/finance/leave-requests/{requestId}/approve',
  // Çalışma onayı kaydı açılışı; çift tıklama aynı öğretmene ikinci başvuru açmaz
  // (routes/finance-work-permits.ts; DOM-FIN-114, ON-174).
  'POST /api/v1/finance/work-permits',
  // Gezi planı taslağı numaralı plan açar; çift tıklama ikinci planı açmaz
  // (routes/finance-trip-plans.ts; DOM-FIN-111, ON-155).
  'POST /api/v1/finance/trip-plans',
  // İş teklifi açılışı; çift tıklama ikinci teklifi açmaz
  // (routes/finance-staff-onboarding.ts; DOM-FIN-121, ON-179).
  'POST /api/v1/finance/job-offers',
  // Bordro hesabının kaydı eski hesabı arşivler ve yeni revizyon yazar; çift tıklama ikinci
  // revizyonu açmaz (routes/finance-payroll-runs.ts; DOM-FIN-115, ON-198).
  'POST /api/v1/finance/payroll-runs/{month}/calculate',
  // Ek ders çizelgesini gönderme, öğretmen yanıtı, müdür onayı (kilit) ve yeniden açma; çift
  // tıklama ikinci yanıtı ya da ikinci onayı yazmaz (routes/finance-lesson-hour-approvals.ts;
  // DOM-FIN-120, ON-196).
  'POST /api/v1/finance/lesson-hour-sheets/{month}/submit',
  'POST /api/v1/finance/lesson-hour-sheets/{month}/confirmations',
  'POST /api/v1/finance/lesson-hour-sheets/{month}/approve',
  'POST /api/v1/finance/lesson-hour-sheets/{month}/reopen',
  // İşten ayrılış dosyası açılışı ve tamamlanması (ilişik kesme, izin günü dondurulur); çift tıklama
  // ikinci dosyayı açmaz (routes/finance-staff-separations.ts; DOM-FIN-118, ON-180).
  'POST /api/v1/finance/staff-separations',
  'POST /api/v1/finance/staff-separations/{separationId}/complete',
  // Özlük verisi imhası geri alınamaz; çift tıklama ikinci imha kaydı yazmaz
  // (routes/finance-staff-retention.ts; DOM-FIN-122, ON-176).
  'POST /api/v1/finance/staff-data-destructions',
  // Performans dönemi ve döneme personel ekleme; çift tıklama ikinci dönemi ya da kaydı açmaz
  // (routes/finance-performance.ts; DOM-FIN-124, ON-211).
  'POST /api/v1/finance/performance-periods',
  'POST /api/v1/finance/performance-periods/{periodId}/reviews',
  // Politika belgesi yayımı önceki sürümü geçersiz kılar; onay kaydı personel × sürüm başına
  // tekildir; çift tıklama ikinci sürümü ya da 409'u üretmez
  // (routes/finance-policy-acknowledgements.ts; DOM-FIN-127, ON-190).
  'POST /api/v1/finance/policy-documents',
  'POST /api/v1/finance/policy-acknowledgements',
  // Açık pozisyon açılışı; çift tıklama ikinci pozisyonu açmaz
  // (routes/finance-staffing-plans.ts; DOM-FIN-126, ON-188).
  'POST /api/v1/finance/staffing-positions',
  // Mesleki gelişim kataloğuna eğitim ekleme ve personel atama; çift tıklama ikinci eğitimi ya da
  // ikinci atamayı açmaz (routes/finance-professional-development.ts; DOM-FIN-125, ON-214).
  'POST /api/v1/finance/professional-development',
  'POST /api/v1/finance/professional-development/{programId}/enrollments',
  // Öz değerlendirme şablonu ve personel adına yanıt açma; çift tıklama ikinci şablonu ya da
  // yanıtı açmaz (routes/finance-self-evaluations.ts; DOM-FIN-131, ON-210).
  'POST /api/v1/finance/performance-periods/{periodId}/self-evaluation-template',
  'POST /api/v1/finance/performance-periods/{periodId}/self-evaluations',
  // Organizasyon birimi, pozisyonu ve ataması; çift tıklama ikinci birimi, pozisyonu ya da atamayı
  // açmaz (routes/finance-org-chart.ts; DOM-FIN-129, ON-187).
  'POST /api/v1/finance/org-units',
  'POST /api/v1/finance/org-positions',
  'POST /api/v1/finance/org-assignments',
  // İş ilanı açılışı, başvuru kaydı ve toplu anonimleştirme; çift tıklama ikinci ilanı ya da
  // başvuruyu açmaz, anonimleştirme geri alınamaz (routes/finance-job-postings.ts; DOM-FIN-128,
  // ON-177).
  'POST /api/v1/finance/job-postings',
  'POST /api/v1/finance/job-applications',
  'POST /api/v1/finance/job-application-anonymizations',
  // Zümre toplantısı tutanağı ve karar ekleme; çift tıklama ikinci tutanağı ya da ikinci kararı
  // açmaz (routes/finance-department-meetings.ts; DOM-FIN-132, ON-217).
  'POST /api/v1/finance/department-meetings',
  'POST /api/v1/finance/department-meetings/{meetingId}/decisions',
  // Kurul ve zümre gündem şablonu; çift tıklama ikinci şablonu açmaz (DOM-FIN-135, ON-218).
  'POST /api/v1/finance/department-meeting-templates',
  // Ders gözlem formu ve gözlem açma; çift tıklama ikinci formu ya da gözlemi açmaz
  // (routes/finance-lesson-observations.ts; DOM-FIN-130, ON-206).
  'POST /api/v1/finance/lesson-observation-templates',
  'POST /api/v1/finance/lesson-observations',
  // Gözlem sonrası görüşme ve gelişim hedefi açma; çift tıklama ikinci kaydı açmaz
  // (routes/finance-observation-debriefs.ts; DOM-FIN-133, ON-209).
  'POST /api/v1/finance/lesson-observations/{observationId}/debrief',
  'POST /api/v1/finance/development-goals',
  // Geri bildirim şablonu ve değerlendiren ataması; çift tıklama ikinci şablonu ya da atamayı
  // açmaz (routes/finance-staff-feedback.ts; DOM-FIN-134, ON-212).
  'POST /api/v1/finance/performance-periods/{periodId}/staff-feedback-template',
  'POST /api/v1/finance/performance-periods/{periodId}/staff-feedback-assignments',
  // Performans raporu kesinleştirme ve personel adına "okudum" kaydı; çift tıklama ikinci kaydı
  // açmaz (routes/finance-performance-reports.ts; DOM-FIN-137, ON-220).
  'POST /api/v1/finance/performance-reviews/{reviewId}/report/finalize',
  'POST /api/v1/finance/performance-reviews/{reviewId}/report/acknowledge',
  // Mentorluk eşleşmesi ve görüşme kaydı; çift tıklama ikinci eşleşmeyi ya da görüşmeyi yazmaz
  // (routes/finance-teacher-mentorships.ts; DOM-FIN-136, ON-219).
  'POST /api/v1/finance/teacher-mentorships',
  'POST /api/v1/finance/teacher-mentorships/{mentorshipId}/meetings',
  // Özlük kartı açma; çift tıklama ikinci kartı açmaz (routes/finance-personnel-files.ts;
  // DOM-FIN-140, ON-172).
  'POST /api/v1/finance/personnel-files',
  // Gözlem planı açma; çift tıklama ikinci planı ve bildirimi açmaz
  // (routes/finance-observation-plans.ts; DOM-FIN-139, ON-207).
  'POST /api/v1/finance/observation-plans',
  // Ziyaretçi girişi ve toplu anonimleştirme; çift tıklama ikinci girişi yazmaz, anonimleştirme
  // geri alınamaz (routes/finance-visitors.ts; DOM-FIN-141, ON-166).
  'POST /api/v1/finance/visitors',
  'POST /api/v1/finance/visitor-anonymizations',
  // Mülakat formu, mülakat planı ve değerlendirici formu; çift tıklama ikinci formu ya da mülakatı
  // açmaz, değerlendirme bir kez gönderilir (routes/finance-candidate-interviews.ts; DOM-FIN-138,
  // ON-178).
  'POST /api/v1/finance/interview-templates',
  'POST /api/v1/finance/job-applications/{applicationId}/interviews',
  'POST /api/v1/finance/candidate-interviews/{interviewId}/evaluation',
  // Personel anketi taslağı, yeni sürüm ve personelin yanıtı; çift tıklama ikinci taslağı ya da
  // ikinci yanıtı yazmaz, yanıtın özeti gövdesizdir (routes/finance-staff-surveys.ts; DOM-FIN-143,
  // ON-191).
  'POST /api/v1/finance/staff-surveys',
  'POST /api/v1/finance/staff-surveys/{surveyId}/copy',
  'POST /api/v1/finance/staff-surveys/{surveyId}/responses',
  // Kaza tutanağı, veli bildirimi ve ek not; çift tıklama ikinci tutanağı ya da kaydı yazmaz
  // (routes/finance-incidents.ts; DOM-FIN-146, ON-162).
  'POST /api/v1/finance/incidents',
  'POST /api/v1/finance/incidents/{incidentId}/notifications',
  'POST /api/v1/finance/incidents/{incidentId}/addenda',
]
// Onur: kayıt ve finans sonu

describe('yazma uçları', () => {
  useCommandsHarness()

  // Onur: kayıt ve finans
  describe('POST /workflows/renewal (DOM-FIN-002, -005, -020, -025)', () => {
    const body = {
      studentId: 's3',
      targetClassId: 'c1',
      year: 2027,
      mode: 'renew',
      total: 28_500,
      scholarship: 0,
      discount: 0,
      count: 8,
      startDate: '2026-11-15',
    }
    const renew = (cookie: string, input: unknown = body) =>
      post('/api/v1/workflows/renewal', cookie, input, { 'idempotency-key': randomUUID() })

    async function publishTuition(
      institutionId: string,
      academicYear: number,
      amountCents: number,
    ) {
      await db.insert(feeTariffs).values({
        institutionId,
        id: randomUUID(),
        academicYear,
        versionNumber: 1,
        status: 'published',
        items: [
          {
            kind: 'tuition',
            level: null,
            amountCents,
            unit: 'year',
            vatBasisPoints: 1000,
            vatEffectiveDate: '2026-01-01',
            announcedAmountCents: amountCents,
          },
        ],
        announcedDate: '2026-05-01',
        publishedByUserId: 'test',
        publishedAt: FIXED_NOW,
      })
    }

    test('hedef yılın tarifesi olmadan yenileme reddedilir, kayıt açılmaz', async () => {
      const a = await institution()
      await publishTuition(a.id, 2026, 2_850_000)
      const before = await count(a.id, 'renewals')
      assertError(await renew(a.adminCookie), 422, 'tariff_not_published')
      assert.equal(await count(a.id, 'renewals'), before)
    })

    test('ilanı aşan, serbest indirimli ya da serbest burslu yenileme reddedilir; tarifeye uyan açılır', async () => {
      const a = await institution()
      await publishTuition(a.id, 2027, 2_850_000)
      const before = await count(a.id, 'renewals')
      assertError(
        await renew(a.adminCookie, { ...body, total: 28_501 }),
        422,
        'renewal_above_tariff',
      )
      assertError(
        await renew(a.adminCookie, { ...body, discount: 1 }),
        422,
        'discount_not_in_tariff',
      )
      assertError(
        await renew(a.adminCookie, { ...body, scholarship: 10 }),
        422,
        'scholarship_program_required',
      )
      assert.equal(await count(a.id, 'renewals'), before)
      const created = await renew(a.adminCookie)
      assert.equal(created.statusCode, 200, created.body)
      assert.equal(await count(a.id, 'renewals'), before + 1)
    })

    test('DOM-FIN-005: devam eden öğrencide köprü de artış tavanını uygular; oran yoksa reddeder', async () => {
      const a = await institution()
      await publishTuition(a.id, 2027, 2_850_000)
      await insertMissingRecords(
        db,
        a.id,
        [
          {
            collection: 'contracts',
            id: 'test-contract-s3',
            data: {
              id: 'test-contract-s3',
              studentId: 's3',
              date: FIXED_NOW.toISOString(),
              amount: 2_000_000,
              title: 'Özel okul eğitim sözleşmesi',
              academicYear: 2026,
              grossCents: 2_000_000,
            },
          },
        ],
        FIXED_NOW,
      )
      const before = await count(a.id, 'renewals')
      assertError(await renew(a.adminCookie), 422, 'price_index_missing')
      // ÜFE %40 + TÜFE %30: tavan 20.000 ₺ × 1,40 = 28.000 ₺.
      await db.insert(priceIndexRates).values({
        institutionId: a.id,
        academicYear: 2027,
        ppiBasisPoints: 4_000,
        cpiBasisPoints: 3_000,
        source: 'TÜİK bülteni',
        bulletinDate: '2026-02-03',
      })
      assertError(await renew(a.adminCookie), 422, 'renewal_above_ceiling')
      assert.equal(await count(a.id, 'renewals'), before)
      const created = await renew(a.adminCookie, { ...body, total: 28_000 })
      assert.equal(created.statusCode, 200, created.body)
    })

    test('başka kurumun tarifesi geçerli sayılmaz', async () => {
      const a = await institution()
      const other = await institution()
      await publishTuition(other.id, 2027, 2_850_000)
      assertError(await renew(a.adminCookie), 422, 'tariff_not_published')
    })
  })
  // Onur: kayıt ve finans sonu

  describe('Idempotency-Key envanteri', () => {
    test('OpenAPI: zorunlu Idempotency-Key uçlarında başlık required, diğerlerinde isteğe bağlı', () => {
      const document = app.swagger() as {
        paths: Record<string, Record<string, { parameters?: Record<string, unknown>[] }>>
      }
      const required: string[] = []
      for (const [path, methods] of Object.entries(document.paths))
        for (const [method, operation] of Object.entries(methods))
          for (const parameter of operation.parameters ?? [])
            if (parameter.in === 'header' && parameter.name === 'idempotency-key') {
              assert.equal('x-kampus-required-header' in (parameter.schema as object), false)
              if (parameter.required === true) required.push(`${method.toUpperCase()} ${path}`)
            }
      const expected = [...PLATFORM_IDEMPOTENT_ENDPOINTS, ...ONUR_IDEMPOTENT_ENDPOINTS]
      // Bir uç iki kaynakta bulunmaz; yinelenen satır envanteri sessizce şişirirdi.
      assert.equal(new Set(expected).size, expected.length, 'yinelenen envanter satırı')
      assert.deepEqual(required.sort(), expected.sort())
    })
  })
})
