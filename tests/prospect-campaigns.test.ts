import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import {
  campaignFunnel,
  campaignFunnelCsv,
  type CampaignFunnelCampaign,
  type CampaignFunnelProspect,
} from '../packages/school-core/src/lib/enrollment-campaign-funnel.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertCampaignCodeFree,
  assertCampaignDates,
  campaignCodeSchema,
  campaignSourceSuggestion,
  campaignStatus,
  createCampaignSchema,
  requireUsableCampaign,
  updateCampaignSchema,
  type CampaignRef,
} from '../packages/school-core/src/lib/prospect-campaigns.ts'
import {
  changeProspectStage,
  createProspect,
  revertProspectStage,
} from '../packages/school-core/src/lib/prospects.ts'

// Kampanya kodu ve kaynak izleme (DOM-KAY-041; IST-117, ON-134). 2026-10-06 Europe/Istanbul'da
// 13:00'tür; kampanya günleri iki uç dahil bu güne göre denetlenir.
const now = '2026-10-06T10:00:00.000Z'
const today = '2026-10-06'
let sequence = 0
const id = (prefix: string) => `${prefix}-campaign-test-${++sequence}`
const front: Participant = { role: 'onburo', links: [], userId: 'u-front' }
const admin: Participant = { role: 'yonetici', links: [], userId: 'u-admin' }

const campaign = (overrides: Partial<CampaignRef> = {}): CampaignRef => ({
  id: 'cmp-1',
  code: 'YAZ26',
  isActive: true,
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  ...overrides,
})
const input = (overrides: Record<string, unknown> = {}) => ({
  name: 'Kampanya Aday',
  phone: '05559990077',
  branchId: 'b1',
  interest: '7. Sınıf · Ortaokul',
  source: 'Sosyal medya',
  guardianName: 'Kampanya Veli',
  privacyNoticeVersion: 'aydinlatma-2026-1',
  ...overrides,
})
const fails =
  (code: string, kind = 'rule', path?: readonly string[]) =>
  (error: unknown) =>
    error instanceof DomainError &&
    error.code === code &&
    error.kind === kind &&
    (path === undefined || JSON.stringify(error.path) === JSON.stringify(path))
function unchangedOnFailure(state: State, action: () => unknown, check: (e: unknown) => boolean) {
  const before = JSON.stringify(state.prospects)
  assert.throws(action, check)
  assert.equal(JSON.stringify(state.prospects), before)
}

test('DOM-KAY-041: kod büyük harfe çevrilir; 3–20 karakter, İngilizce harf, rakam ve tire', () => {
  assert.equal(campaignCodeSchema.parse('  yaz-26 '), 'YAZ-26')
  assert.equal(campaignCodeSchema.parse('fuar2026'), 'FUAR2026')
  for (const bad of ['AB', 'A'.repeat(21), 'KIŞ26', '-YAZ', 'YAZ 26', 'YAZ_26'])
    assert.equal(campaignCodeSchema.safeParse(bad).success, false, bad)
})

test('DOM-KAY-041: tanım şeması tarih sırasını ister, düzeltmede kod değişmez', () => {
  const valid = {
    code: 'yaz26',
    name: 'Yaz okulu ilanı',
    channel: 'social_media',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  }
  const parsed = createCampaignSchema.parse(valid)
  assert.equal(parsed.code, 'YAZ26')
  assert.equal(parsed.isActive, true)
  assert.equal(parsed.costCents, undefined)
  assert.equal(createCampaignSchema.safeParse({ ...valid, endDate: '2026-09-30' }).success, false)
  assert.equal(createCampaignSchema.safeParse({ ...valid, costCents: -1 }).success, false)
  assert.equal(createCampaignSchema.safeParse({ ...valid, costCents: 10.5 }).success, false)
  assert.equal(createCampaignSchema.safeParse({ ...valid, channel: 'tv' }).success, false)
  assert.equal(createCampaignSchema.safeParse({ ...valid, institutionId: 'x' }).success, false)
  assert.equal(updateCampaignSchema.safeParse({ code: 'YENI26' }).success, false)
  assert.equal(updateCampaignSchema.safeParse({}).success, false)
  assert.deepEqual(updateCampaignSchema.parse({ costCents: null }), { costCents: null })
  assert.throws(
    () => assertCampaignDates('2026-10-02', '2026-10-01'),
    fails('campaign_dates_invalid', 'rule', ['endDate']),
  )
  assertCampaignDates('2026-10-01', '2026-10-01')
  assert.throws(() => assertCampaignCodeFree(true), fails('campaign_code_exists', 'conflict'))
  assertCampaignCodeFree(false)
})

test('DOM-KAY-041: kampanya durumu bugüne göre; iki uç dahil, pasif önce gelir', () => {
  assert.equal(campaignStatus(campaign(), today), 'usable')
  assert.equal(campaignStatus(campaign({ startDate: today, endDate: today }), today), 'usable')
  assert.equal(campaignStatus(campaign({ startDate: '2026-10-07' }), today), 'not_started')
  assert.equal(campaignStatus(campaign({ endDate: '2026-10-05' }), today), 'ended')
  assert.equal(
    campaignStatus(campaign({ isActive: false, endDate: '2026-10-05' }), today),
    'inactive',
  )
  const path = ['campaignCode']
  assert.throws(
    () => requireUsableCampaign(null, today),
    fails('campaign_code_not_found', 'rule', path),
  )
  assert.throws(
    () => requireUsableCampaign(campaign({ isActive: false }), today),
    fails('campaign_code_inactive', 'rule', path),
  )
  assert.throws(
    () => requireUsableCampaign(campaign({ startDate: '2026-10-07' }), today),
    fails('campaign_code_not_started', 'rule', path),
  )
  assert.throws(
    () => requireUsableCampaign(campaign({ endDate: '2026-10-05' }), today),
    fails('campaign_code_ended', 'rule', path),
  )
})

test('DOM-KAY-041, K-289: kaynak kanaldan önerilir; karşılığı olmayan kanalda öneri yok', () => {
  assert.equal(campaignSourceSuggestion('social_media'), 'Sosyal medya')
  assert.equal(campaignSourceSuggestion('website'), 'Web sitesi')
  assert.equal(campaignSourceSuggestion('referral'), 'Veli referansı')
  for (const channel of ['flyer', 'fair', 'other'] as const)
    assert.equal(campaignSourceSuggestion(channel), null)
})

test('DOM-KAY-041: kod girilen aday kampanyaya bağlanır; kaynak serbest kalır', () => {
  const state = createSeed(new Date(now))
  const created = createProspect(
    state,
    front,
    input({ campaignCode: 'yaz26', source: 'Kampüs ziyareti' }),
    id,
    now,
    { campaign: campaign() },
  )
  assert.equal(created.campaignId, 'cmp-1')
  assert.equal(created.campaignCode, 'YAZ26')
  assert.equal(created.source, 'Kampüs ziyareti')
  // Kod girilmezse servisin verdiği kampanya okunmaz.
  const plain = createProspect(state, front, input({ phone: '05559990078' }), id, now, {
    campaign: campaign(),
  })
  assert.equal(plain.campaignId, undefined)
  assert.equal(plain.campaignCode, undefined)
})

test('DOM-KAY-041: bulunmayan, pasif, başlamamış ya da bitmiş kod 422; aday açılmaz', () => {
  const state = createSeed(new Date(now))
  const attempt =
    (found: CampaignRef | null, code = 'YAZ26') =>
    () =>
      createProspect(state, front, input({ campaignCode: code }), id, now, { campaign: found })
  const path = ['campaignCode']
  unchangedOnFailure(state, attempt(null), fails('campaign_code_not_found', 'rule', path))
  // Servisin bulduğu kampanya başka koda aitse bulunmamış sayılır.
  unchangedOnFailure(state, attempt(campaign(), 'KIS26'), fails('campaign_code_not_found'))
  unchangedOnFailure(
    state,
    () => createProspect(state, front, input({ campaignCode: 'YAZ26' }), id, now),
    fails('campaign_code_not_found'),
  )
  unchangedOnFailure(state, attempt(campaign({ isActive: false })), fails('campaign_code_inactive'))
  unchangedOnFailure(
    state,
    attempt(campaign({ startDate: '2026-10-07' })),
    fails('campaign_code_not_started'),
  )
  unchangedOnFailure(
    state,
    attempt(campaign({ endDate: '2026-10-05' })),
    fails('campaign_code_ended'),
  )
  // Biçimsiz kod şema hatasıdır (400).
  assert.throws(
    attempt(campaign(), 'Ş!'),
    (error: unknown) => error instanceof Error && error.name === 'ZodError',
  )
})

test('DOM-KAY-041, K-290: teklif aşamasına ilk geçiş izlenir; vazgeçince kalır, geri alınınca kalkar', () => {
  const state = createSeed(new Date(now))
  const created = createProspect(state, front, input(), id, now)
  const later = '2026-10-07T10:00:00.000Z'
  changeProspectStage(state, front, created.id, { stage: 'Teklif verildi' }, now)
  assert.equal(created.offeredAt, now)
  changeProspectStage(state, front, created.id, { stage: 'Vazgeçti', lostReason: 'price' }, later)
  assert.equal(created.offeredAt, now)
  changeProspectStage(state, front, created.id, { stage: 'İletişime geçildi' }, later)
  changeProspectStage(state, front, created.id, { stage: 'Teklif verildi' }, later)
  // İlk teklif anı korunur.
  assert.equal(created.offeredAt, now)
  revertProspectStage(
    state,
    admin,
    created.id,
    { stage: 'İletişime geçildi', reason: 'Yanlış aşama' },
    later,
  )
  assert.equal(created.offeredAt, undefined)
})

const campaignRow = (overrides: Partial<CampaignFunnelCampaign> = {}): CampaignFunnelCampaign => ({
  id: 'cmp-1',
  code: 'YAZ26',
  name: 'Yaz ilanı',
  channel: 'social_media',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  costCents: 100_000,
  isActive: true,
  archived: false,
  ...overrides,
})
const p = (overrides: CampaignFunnelProspect = {}): CampaignFunnelProspect => ({
  stage: 'Yeni aday',
  ...overrides,
})

test('DOM-KAY-041: kırılım birikimlidir; teklif izi vazgeçen adayda da sayılır, kodsuz ayrı satırdır', () => {
  const prospects = [
    p({ campaignId: 'cmp-1' }),
    p({ campaignId: 'cmp-1', stage: 'Görüşme planlandı' }),
    // Görüşmesiz teklif: görüşmeyi geçmiş sayılır.
    p({ campaignId: 'cmp-1', stage: 'Teklif verildi' }),
    p({ campaignId: 'cmp-1', stage: 'Vazgeçti', offeredAt: now, meeting: {} }),
    p({ campaignId: 'cmp-1', stage: 'Kayıt oldu', studentId: 's9' }),
    p({ campaignId: 'cmp-2', stage: 'Kayıt oldu' }),
    p({ campaignId: 'cmp-gone' }),
    p({}),
    p({ campaignId: '', stage: 'Teklif verildi' }),
  ]
  const funnel = campaignFunnel(
    prospects,
    [
      campaignRow(),
      campaignRow({ id: 'cmp-2', code: 'FUAR26', channel: 'fair', costCents: null }),
      // Adayı olmayan arşivli kampanya satır almaz; adayı olmayan etkin kampanya alır.
      campaignRow({ id: 'cmp-3', code: 'ESKI', archived: true }),
      campaignRow({ id: 'cmp-4', code: 'AAA', isActive: false }),
    ],
    'school',
  )
  assert.deepEqual(funnel.total, {
    prospects: 9,
    meetings: 6,
    offers: 5,
    enrolled: 2,
    conversionRate: 22.2,
  })
  assert.deepEqual(funnel.uncoded, {
    prospects: 2,
    meetings: 1,
    offers: 1,
    enrolled: 0,
    conversionRate: 0,
  })
  assert.deepEqual(
    funnel.rows.map((row) => [
      row.campaign.code,
      row.prospects,
      row.meetings,
      row.offers,
      row.enrolled,
    ]),
    [
      ['YAZ26', 5, 4, 3, 1],
      ['FUAR26', 1, 1, 1, 1],
      ['AAA', 0, 0, 0, 0],
    ],
  )
  const [yaz, fuar, empty] = funnel.rows
  assert.equal(yaz?.conversionRate, 20)
  assert.equal(yaz?.costPerProspectCents, 20_000)
  assert.equal(yaz?.costPerEnrollmentCents, 100_000)
  assert.equal(yaz?.costPartial, false)
  assert.equal(fuar?.costPerProspectCents, null)
  assert.equal(empty?.conversionRate, null)
  assert.equal(empty?.costPerProspectCents, null)
  // Kişi verisi yok: satır yalnız kampanya tanımı ve sayı taşır.
  assert.equal(JSON.stringify(funnel).includes('s9'), false)
})

test('DOM-KAY-041: dil okulunda deneme dersi görüşme adımıdır; okulda sayılmaz', () => {
  const prospects = [p({ campaignId: 'cmp-1', stage: 'İletişime geçildi', trialLesson: {} })]
  const camp = [campaignRow()]
  assert.equal(campaignFunnel(prospects, camp, 'language_school').rows[0]?.meetings, 1)
  assert.equal(campaignFunnel(prospects, camp, 'school').rows[0]?.meetings, 0)
})

test('DOM-KAY-041, K-290: aralık kampanyayı kısmen kapsıyorsa birim maliyet yok; kesişmeyen kampanya satır almaz', () => {
  const prospects = [p({ campaignId: 'cmp-1' }), p({ campaignId: 'cmp-1', stage: 'Kayıt oldu' })]
  const camps = [
    campaignRow(),
    campaignRow({ id: 'cmp-9', code: 'KIS27', startDate: '2027-01-01', endDate: '2027-01-31' }),
  ]
  const partial = campaignFunnel(prospects, camps, 'school', {
    dateFrom: '2026-10-10',
    dateTo: '2026-12-31',
  })
  assert.deepEqual(
    partial.rows.map((row) => row.campaign.code),
    ['YAZ26'],
  )
  assert.equal(partial.rows[0]?.costPartial, true)
  assert.equal(partial.rows[0]?.costPerProspectCents, null)
  assert.equal(partial.rows[0]?.costPerEnrollmentCents, null)
  const full = campaignFunnel(prospects, camps, 'school', {
    dateFrom: '2026-09-01',
    dateTo: '2026-11-30',
  })
  assert.equal(full.rows[0]?.costPartial, false)
  assert.equal(full.rows[0]?.costPerProspectCents, 50_000)
  assert.equal(full.rows[0]?.costPerEnrollmentCents, 100_000)
  // Kuruşa yuvarlanır.
  const thirds = campaignFunnel(
    [p({ campaignId: 'cmp-1' }), p({ campaignId: 'cmp-1' }), p({ campaignId: 'cmp-1' })],
    [campaignRow({ costCents: 100 })],
    'school',
  )
  assert.equal(thirds.rows[0]?.costPerProspectCents, 33)
})

test('DOM-KAY-041: CSV ayırıcı, formül kaçışı, ondalık virgül; kodsuz ve toplam satırı', () => {
  const funnel = campaignFunnel(
    [p({ campaignId: 'cmp-1', stage: 'Kayıt oldu' }), p({ campaignId: 'cmp-1' }), p({}), p({})],
    [campaignRow({ name: '=HYPERLINK("x")', costCents: 123_456 })],
    'school',
  )
  const lines = campaignFunnelCsv(funnel).trimEnd().split('\r\n')
  assert.equal(lines.length, 4)
  assert.ok(lines[0]?.startsWith('"Kampanya kodu";"Kampanya adı";"Kanal"'))
  assert.equal(
    lines[1],
    '"YAZ26";"\'=HYPERLINK(""x"")";"Sosyal medya";"2026-10-01";"2026-10-31";2;1;1;1;50;1234,56;617,28;1234,56',
  )
  assert.equal(lines[2], '"Kodsuz";"";"";"";"";2;0;0;0;0;;;')
  assert.equal(lines[3], '"Toplam";"";"";"";"";4;1;1;1;25;;;')
})
