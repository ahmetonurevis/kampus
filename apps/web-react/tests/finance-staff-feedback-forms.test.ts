import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  StaffFeedbackOverview,
  StaffFeedbackResultView,
} from '@kampus/react-shared/use-finance-staff-feedback.ts'
import type { StaffFeedbackQuestion } from '@kampus/school-core/lib/finance-staff-feedback.ts'
import {
  STAFF_FEEDBACK_THRESHOLD_OPTIONS,
  staffFeedbackAssignmentFormSchema,
  staffFeedbackAverageText,
  staffFeedbackEditable,
  staffFeedbackPeerHiddenText,
  staffFeedbackProgressText,
  staffFeedbackSummaryText,
  staffFeedbackTemplateDefaults,
  staffFeedbackThresholdText,
  staffFeedbackWithdrawFormSchema,
} from '../src/pages/finance/finance-staff-feedback-forms.ts'

// Çok kaynaklı geri bildirim formları (DOM-FIN-134; ON-212; K-457…K-459).

const QUESTIONS: StaffFeedbackQuestion[] = [
  { kind: 'scale', text: 'Ekip çalışmasına katkısı', required: true },
  { kind: 'open', text: 'Güçlü yanları neler?', required: false },
]
const TEMPLATE: NonNullable<StaffFeedbackOverview['template']> = {
  id: 't-1',
  periodId: 'p-1',
  questions: QUESTIONS,
  responseCount: 0,
  locked: false,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  version: 1,
}
const peer = (
  patch: Partial<StaffFeedbackResultView['peer']>,
): StaffFeedbackResultView['peer'] => ({
  assigned: 4,
  responded: 2,
  rate: 50,
  visible: false,
  hiddenReason: 'below_threshold',
  questions: [],
  ...patch,
})

test('DOM-FIN-134 K-457: şablon varsayılanı boş tek soru ya da kayıtlı sorular', () => {
  assert.deepEqual(staffFeedbackTemplateDefaults(null), {
    questions: [{ kind: 'scale', text: '', required: true }],
  })
  const defaults = staffFeedbackTemplateDefaults(TEMPLATE)
  assert.deepEqual(defaults.questions, QUESTIONS)
  assert.notEqual(defaults.questions[0], QUESTIONS[0])
})

test('DOM-FIN-134 K-458: atama formu değerlendireni ve ilişkiyi ister', () => {
  assert.equal(
    staffFeedbackAssignmentFormSchema.safeParse({ reviewerMembershipId: '', relation: 'peer' })
      .success,
    false,
  )
  assert.equal(
    staffFeedbackAssignmentFormSchema.safeParse({ reviewerMembershipId: 'm-1', relation: 'self' })
      .success,
    false,
  )
  assert.equal(
    staffFeedbackAssignmentFormSchema.safeParse({
      reviewerMembershipId: 'm-1',
      relation: 'manager',
    }).success,
    true,
  )
})

test('DOM-FIN-134 K-458: geri alma gerekçesi 5–500 karakter', () => {
  assert.equal(staffFeedbackWithdrawFormSchema.safeParse({ reason: ' kısa ' }).success, false)
  assert.equal(
    staffFeedbackWithdrawFormSchema.safeParse({ reason: 'Yanlış kişinin formu' }).success,
    true,
  )
  assert.equal(
    staffFeedbackWithdrawFormSchema.safeParse({ reason: 'x'.repeat(501) }).success,
    false,
  )
})

test('DOM-FIN-134 K-459: eşik seçenekleri 3–10', () => {
  assert.deepEqual(STAFF_FEEDBACK_THRESHOLD_OPTIONS, ['3', '4', '5', '6', '7', '8', '9', '10'])
  assert.match(staffFeedbackThresholdText(3), /en az 3 yanıtla/)
})

test('DOM-FIN-134 K-458: özet ve ilerleme metni', () => {
  const empty = { assigned: 0, responded: 0, rate: null }
  assert.equal(
    staffFeedbackSummaryText({
      ...empty,
      pending: 0,
      byRelation: { manager: empty, peer: empty },
    }),
    'Henüz değerlendiren atanmadı.',
  )
  assert.equal(
    staffFeedbackSummaryText({
      assigned: 3,
      responded: 1,
      rate: 33.3,
      pending: 2,
      byRelation: {
        manager: { assigned: 1, responded: 1, rate: 100 },
        peer: { assigned: 2, responded: 0, rate: 0 },
      },
    }),
    'Yanıtlanan 1 / 3 (%33,3) · Yönetici 1 / 1 · Meslektaş 0 / 2',
  )
  assert.equal(staffFeedbackProgressText(empty), '—')
})

test('DOM-FIN-134 K-459: meslektaş sonucunun gizlilik gerekçesi ve ortalama metni', () => {
  assert.equal(
    staffFeedbackPeerHiddenText(peer({ hiddenReason: 'period_open' }), 3),
    'Meslektaş sonucu dönem değerlendirme aşamasına geçince gösterilir (şu an 2 yanıt).',
  )
  assert.equal(
    staffFeedbackPeerHiddenText(peer({}), 3),
    'Meslektaş sonucu gizli: en az 3 yanıt gerekir, 2 yanıt var.',
  )
  assert.equal(
    staffFeedbackPeerHiddenText(peer({ visible: true, hiddenReason: null, responded: 3 }), 3),
    null,
  )
  assert.equal(staffFeedbackAverageText(3.67), '3,67 / 5')
  assert.equal(staffFeedbackAverageText(4), '4 / 5')
  assert.equal(staffFeedbackAverageText(null), '—')
})

test('DOM-FIN-134 K-457 K-458: aşamaya göre açık işlemler', () => {
  assert.deepEqual(staffFeedbackEditable('planning', null), {
    template: true,
    assign: true,
    respond: false,
  })
  assert.deepEqual(staffFeedbackEditable('active', TEMPLATE), {
    template: true,
    assign: true,
    respond: true,
  })
  assert.deepEqual(staffFeedbackEditable('interim', { ...TEMPLATE, locked: true }), {
    template: false,
    assign: true,
    respond: true,
  })
  assert.deepEqual(staffFeedbackEditable('evaluation', TEMPLATE), {
    template: true,
    assign: false,
    respond: false,
  })
  assert.deepEqual(staffFeedbackEditable('closed', TEMPLATE), {
    template: false,
    assign: false,
    respond: false,
  })
})
