import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CampaignFunnel, CampaignRow } from '@kampus/react-shared/use-prospect-campaigns.ts'
import {
  campaignCodeFromParam,
  campaignDefaults,
  campaignFormField,
  campaignFormSchema,
  campaignFunnelRows,
  campaignListRow,
  createCampaignBody,
  newCampaignFormSchema,
  parseCampaignCost,
  suggestedSource,
  updateCampaignBody,
} from '../src/pages/crm/prospect-campaign-forms.ts'
import { createBody, createDefaults, createFormSchema } from '../src/pages/crm/prospect-forms.ts'

// Kampanya kodu formu, aday formundaki kod ve kampanya kırılımı satırları (DOM-KAY-041; ON-134).

const CAMPAIGN: CampaignRow = {
  id: 'cmp-1',
  code: 'YAZ26',
  name: 'Yaz ilanı',
  channel: 'social_media',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  costCents: 1_250_000,
  isActive: true,
  status: 'usable',
  version: 3,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
}

test('DOM-KAY-041: yeni kampanya gövdesi kodu büyük harfe çevirir, maliyeti kuruşa', () => {
  const values = {
    ...campaignDefaults(undefined, '2026-10-06'),
    code: ' yaz-26 ',
    name: ' Yaz ilanı ',
    endDate: '2026-10-31',
    cost: '12.500,00',
  }
  assert.equal(newCampaignFormSchema.safeParse(values).success, true)
  assert.deepEqual(createCampaignBody(values), {
    code: 'YAZ-26',
    name: 'Yaz ilanı',
    channel: 'social_media',
    startDate: '2026-10-06',
    endDate: '2026-10-31',
    costCents: 1_250_000,
    isActive: true,
  })
  // Boş maliyet gövdeye girmez.
  assert.equal('costCents' in createCampaignBody({ ...values, cost: '' }), false)
})

test('DOM-KAY-041: form biçimsiz kodu, ters günleri ve geçersiz tutarı reddeder', () => {
  const base = { ...campaignDefaults(CAMPAIGN) }
  assert.equal(newCampaignFormSchema.safeParse({ ...base, code: 'KIŞ' }).success, false)
  assert.equal(campaignFormSchema.safeParse({ ...base, endDate: '2026-09-01' }).success, false)
  assert.equal(campaignFormSchema.safeParse({ ...base, cost: '12,345' }).success, false)
  assert.equal(campaignFormSchema.safeParse({ ...base, cost: '0' }).success, true)
  assert.equal(parseCampaignCost('1.000,5'), 100_050)
})

test('DOM-KAY-041: düzeltme gövdesi yalnız değişen alanları taşır; boşaltılan maliyet null', () => {
  const values = campaignDefaults(CAMPAIGN)
  assert.equal(values.cost, '12500,00')
  assert.deepEqual(updateCampaignBody(values, CAMPAIGN), {})
  assert.deepEqual(updateCampaignBody({ ...values, cost: '', isActive: false }, CAMPAIGN), {
    costCents: null,
    isActive: false,
  })
  assert.equal(campaignFormField('costCents'), 'cost')
  assert.equal(campaignFormField('endDate'), 'endDate')
  assert.equal(campaignFormField('institutionId'), null)
})

test('DOM-KAY-041: liste satırı kanal, dönem, maliyet ve durumu Türkçe gösterir', () => {
  const row = campaignListRow({ ...CAMPAIGN, costCents: null, status: 'ended' })
  assert.equal(row.channel, 'Sosyal medya')
  assert.equal(row.cost, '—')
  assert.equal(row.statusLabel, 'Sona erdi')
  assert.match(row.period, /2026.*–.*2026/)
})

test('DOM-KAY-041, K-289: adresteki kod biçimlenir; kaynak bilinen kampanyanın kanalından önerilir', () => {
  assert.equal(campaignCodeFromParam('yaz26'), 'YAZ26')
  assert.equal(campaignCodeFromParam('<script>'), '')
  assert.equal(campaignCodeFromParam(null), '')
  assert.equal(suggestedSource('yaz26', [CAMPAIGN]), 'Sosyal medya')
  assert.equal(suggestedSource('FUAR26', [CAMPAIGN]), null)
  assert.equal(suggestedSource('FUAR26', [{ code: 'FUAR26', channel: 'fair' }]), null)
})

test('DOM-KAY-041: aday formu kodu isteğe bağlı taşır, büyük harfle gönderir', () => {
  const schema = createFormSchema('school')
  const values = {
    ...createDefaults('b1', { code: 'yaz26', source: 'Sosyal medya' }),
    name: 'Test Aday',
    phone: '05559990001',
    interest: '7. Sınıf',
    guardianName: 'Test Veli',
    noticeShown: true,
  }
  assert.equal(values.source, 'Sosyal medya')
  const parsed = schema.parse(values)
  assert.equal(createBody(parsed, 'school').campaignCode, 'YAZ26')
  const without = schema.parse({ ...values, campaignCode: '' })
  assert.equal('campaignCode' in createBody(without, 'school'), false)
  assert.equal(schema.safeParse({ ...values, campaignCode: 'Ş!' }).success, false)
  assert.equal(createDefaults('b1').source, 'Web sitesi')
})

test('DOM-KAY-041: kırılım satırları kampanya, kodsuz ve toplamla; kısmi aralıkta birim maliyet yazmaz', () => {
  const counts = { prospects: 4, meetings: 3, offers: 2, enrolled: 1, conversionRate: 25 }
  const funnel: CampaignFunnel = {
    dateFrom: '2026-10-05',
    dateTo: null,
    total: { ...counts, prospects: 6, conversionRate: 16.7 },
    uncoded: { prospects: 2, meetings: 0, offers: 0, enrolled: 0, conversionRate: 0 },
    rows: [
      {
        campaign: { ...CAMPAIGN, archived: true },
        ...counts,
        costPerProspectCents: null,
        costPerEnrollmentCents: null,
        costPartial: true,
      },
    ],
  }
  const rows = campaignFunnelRows(funnel)
  assert.deepEqual(
    rows.map((row) => row.campaign),
    ['YAZ26 · Yaz ilanı (arşivli)', 'Kampanya kodu yok', 'Toplam'],
  )
  assert.equal(rows[0]?.conversion, '%25')
  assert.equal(rows[0]?.perProspect, 'Aralık kısmi')
  assert.match(rows[0]?.cost ?? '', /12\.500,00 ₺/)
  assert.equal(rows[2]?.conversion, '%16,7')
  assert.equal(rows[1]?.perEnrollment, '—')
})
