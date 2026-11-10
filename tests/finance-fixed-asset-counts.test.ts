import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fixedAssetCountCsv,
  fixedAssetCountObservedPlace,
  fixedAssetCountOutcome,
  fixedAssetCountScanSchema,
  fixedAssetCountSchema,
  fixedAssetCountScopeIncludes,
  fixedAssetCountScopeKey,
  fixedAssetCountScopeLabel,
  fixedAssetCountScopeOf,
  FIXED_ASSET_COUNT_MAX_ITEMS,
  normalizeFixedAssetCountCode,
  planFixedAssetCountClose,
  planFixedAssetCountRelocate,
  planFixedAssetCountScan,
  planFixedAssetCountStart,
  sameFixedAssetPlace,
  type CountableFixedAsset,
  type FixedAssetCountInput,
  type FixedAssetCountRelocateChecks,
  type FixedAssetCountScanChecks,
  type FixedAssetCountScanInput,
  type FixedAssetCountReportItem,
} from '../packages/school-core/src/lib/finance-fixed-asset-counts.ts'

import { isDomainError } from './support/domain-error.ts'

// Demirbaş sayımı (DOM-FIN-087; ON-237).

const LAB = '2. kat fen laboratuvarı'
const asset = (overrides: Partial<CountableFixedAsset> = {}): CountableFixedAsset => ({
  id: 'a-1',
  tagNumber: 'DB-2026-0001',
  name: 'Akıllı tahta',
  campusId: 'kadikoy',
  location: LAB,
  status: 'in_use',
  ...overrides,
})
const ASSETS: CountableFixedAsset[] = [
  asset({ id: 'a-3', tagNumber: 'DB-2026-0003', location: 'Müdür odası' }),
  asset(),
  asset({ id: 'a-2', tagNumber: 'DB-2026-0002', campusId: 'moda', location: 'Kütüphane' }),
  asset({ id: 'a-4', tagNumber: 'DB-2026-0004', status: 'scrapped' }),
  asset({ id: 'a-5', tagNumber: 'DB-2026-0005', location: '2. KAT  Fen Laboratuvarı ' }),
]
const start = (
  input: FixedAssetCountInput,
  overrides: {
    openSameScope?: boolean
    campusFound?: boolean
    assets?: CountableFixedAsset[]
  } = {},
) =>
  planFixedAssetCountStart(fixedAssetCountSchema.parse(input), {
    openSameScope: false,
    campusFound: true,
    assets: ASSETS,
    ...overrides,
  })
const scanChecks = (
  overrides: Partial<FixedAssetCountScanChecks> = {},
): FixedAssetCountScanChecks => ({
  count: { status: 'open', scopeType: 'institution', campusId: null, location: null },
  asset: asset(),
  item: { result: 'pending', inScope: true, recordedCampusId: 'kadikoy', recordedLocation: LAB },
  campusFound: true,
  ...overrides,
})
const scan = (
  input: FixedAssetCountScanInput,
  overrides: Partial<FixedAssetCountScanChecks> = {},
) => planFixedAssetCountScan(fixedAssetCountScanSchema.parse(input), scanChecks(overrides))

test('DOM-FIN-087: sayım şeması kurum, kampüs ya da oda kapsamı ister; not kırpılır (K-232)', () => {
  assert.deepEqual(fixedAssetCountSchema.parse({ scopeType: 'institution', note: '  ' }), {
    scopeType: 'institution',
    note: null,
  })
  const room = fixedAssetCountSchema.parse({ scopeType: 'location', location: ` ${LAB} ` })
  assert.deepEqual(fixedAssetCountScopeOf(room), {
    scopeType: 'location',
    campusId: null,
    location: LAB,
  })
  for (const bad of [
    {},
    { scopeType: 'campus' },
    { scopeType: 'campus', campusId: ' ' },
    { scopeType: 'location', location: 'A' },
    { scopeType: 'institution', campusId: 'kadikoy' },
    { scopeType: 'institution', note: 'x'.repeat(201) },
  ])
    assert.equal(fixedAssetCountSchema.safeParse(bad).success, false, JSON.stringify(bad))
})

test('DOM-FIN-087: kapsam anahtarı odayı harf ve boşluk farkı gözetmeden yazar (K-234)', () => {
  const key = (input: FixedAssetCountInput) =>
    fixedAssetCountScopeKey(fixedAssetCountScopeOf(fixedAssetCountSchema.parse(input)))
  assert.equal(key({ scopeType: 'institution' }), 'institution')
  assert.equal(key({ scopeType: 'campus', campusId: 'moda' }), 'campus:moda')
  assert.equal(
    key({ scopeType: 'location', campusId: 'kadikoy', location: '2. Kat  FEN Laboratuvarı' }),
    key({ scopeType: 'location', campusId: 'kadikoy', location: LAB }),
  )
  assert.equal(key({ scopeType: 'location', location: 'Şube Ofisi' }), 'location:-:sube ofisi')
  assert.notEqual(
    key({ scopeType: 'location', campusId: 'moda', location: LAB }),
    key({ scopeType: 'location', campusId: 'kadikoy', location: LAB }),
  )
})

test('DOM-FIN-087: beklenen liste kapsamdaki hurdaya ayrılmamış demirbaşlardır, etiket sırasıyla (K-232)', () => {
  const tags = (input: FixedAssetCountInput) => start(input).items.map((item) => item.tagNumber)
  assert.deepEqual(tags({ scopeType: 'institution' }), [
    'DB-2026-0001',
    'DB-2026-0002',
    'DB-2026-0003',
    'DB-2026-0005',
  ])
  assert.deepEqual(tags({ scopeType: 'campus', campusId: 'moda' }), ['DB-2026-0002'])
  assert.deepEqual(
    tags({ scopeType: 'location', campusId: 'kadikoy', location: '2. kat fen LABORATUVARI' }),
    ['DB-2026-0001', 'DB-2026-0005'],
  )
  const planned = start({
    scopeType: 'location',
    campusId: 'kadikoy',
    location: LAB,
    note: ' Yıl sonu ',
  })
  assert.equal(planned.note, 'Yıl sonu')
  assert.equal(planned.scopeKey, 'location:kadikoy:2. kat fen laboratuvari')
  assert.equal(
    fixedAssetCountScopeIncludes(planned.scope, asset({ campusId: null })),
    false,
    'kampüssüz demirbaş kampüslü odaya girmez',
  )
})

test('DOM-FIN-087: başlatma reddi: olmayan kampüs 422, aynı kapsamda açık sayım 409, boş kapsam ve sınır 422 (K-232, K-234)', () => {
  assert.throws(
    () => start({ scopeType: 'campus', campusId: 'yok' }, { campusFound: false }),
    isDomainError('fixed_asset_campus_not_found'),
  )
  assert.throws(
    () => start({ scopeType: 'institution' }, { openSameScope: true }),
    isDomainError('fixed_asset_count_open_exists', 'conflict'),
  )
  assert.throws(
    () => start({ scopeType: 'location', location: 'Depo' }),
    isDomainError('fixed_asset_count_empty'),
  )
  assert.throws(
    () => start({ scopeType: 'institution' }, { assets: [asset({ status: 'scrapped' })] }),
    isDomainError('fixed_asset_count_empty'),
  )
  const many = Array.from({ length: FIXED_ASSET_COUNT_MAX_ITEMS + 1 }, (_, index) =>
    asset({ id: `a-${String(index)}`, tagNumber: `DB-2026-${String(index).padStart(5, '0')}` }),
  )
  assert.throws(
    () => start({ scopeType: 'institution' }, { assets: many }),
    isDomainError('fixed_asset_count_too_large'),
  )
  assert.equal(
    start({ scopeType: 'institution' }, { assets: many.slice(1) }).items.length,
    FIXED_ASSET_COUNT_MAX_ITEMS,
  )
})

test('DOM-FIN-087: okuyucu kodu etiket biçimine çevrilir; Türkçe Q düzeni karakterleri geri döner (K-233)', () => {
  assert.equal(normalizeFixedAssetCountCode(' db-2026-0001 '), 'DB-2026-0001')
  assert.equal(normalizeFixedAssetCountCode('DB*2026*0001'), 'DB-2026-0001')
  assert.equal(normalizeFixedAssetCountCode('LABç01'), 'LAB.01')
  assert.equal(normalizeFixedAssetCountCode('bİl-01'), 'BIL-01')
  assert.equal(fixedAssetCountScanSchema.safeParse({ code: '   ' }).success, false)
  assert.equal(fixedAssetCountScanSchema.safeParse({ code: 'X'.repeat(81) }).success, false)
  assert.equal(fixedAssetCountScanSchema.safeParse({ code: 'DB-1', location: 'A' }).success, false)
})

test('DOM-FIN-087: okutma kayıtlı yerde bulundu, başka yerde yanlış konumda işaretler (K-233)', () => {
  assert.deepEqual(
    scan({ code: 'db-2026-0001', campusId: 'kadikoy', location: '2. KAT fen laboratuvarı' }),
    {
      outcome: 'found',
      inScope: true,
      observed: { campusId: 'kadikoy', location: '2. KAT fen laboratuvarı' },
      recorded: { campusId: 'kadikoy', location: LAB },
    },
  )
  const moved = scan({ code: 'DB-2026-0001', campusId: 'kadikoy', location: 'Müdür odası' })
  assert.equal(moved.outcome, 'misplaced')
  assert.equal(scan({ code: 'DB-2026-0001', location: LAB }).outcome, 'misplaced', 'kampüs farklı')
})

test('DOM-FIN-087: kampüs ve oda sayımında sayılan yer kapsamdan gelir (K-233)', () => {
  const campus = {
    status: 'open',
    scopeType: 'campus',
    campusId: 'kadikoy',
    location: null,
  } as const
  assert.deepEqual(fixedAssetCountObservedPlace(campus, { campusId: 'moda', location: LAB }), {
    campusId: 'kadikoy',
    location: LAB,
  })
  assert.equal(
    scan({ code: 'DB-2026-0001', campusId: 'moda', location: LAB }, { count: campus }).outcome,
    'found',
  )
  const room = {
    status: 'open',
    scopeType: 'location',
    campusId: 'kadikoy',
    location: LAB,
  } as const
  assert.equal(scan({ code: 'DB-2026-0001' }, { count: room }).outcome, 'found')
  assert.equal(
    scan({ code: 'DB-2026-0001', location: 'Başka oda' }, { count: room }).outcome,
    'found',
    'oda sayımında gövdedeki konum yok sayılır',
  )
})

test('DOM-FIN-087: listede olmayan kurum demirbaşı listede yoktu işaretiyle eklenir; yeri tutuyorsa bulundu (K-233)', () => {
  const room = {
    status: 'open',
    scopeType: 'location',
    campusId: 'kadikoy',
    location: LAB,
  } as const
  const other = asset({ id: 'a-3', tagNumber: 'DB-2026-0003', location: 'Müdür odası' })
  assert.deepEqual(scan({ code: 'DB-2026-0003' }, { count: room, asset: other, item: null }), {
    outcome: 'misplaced',
    inScope: false,
    observed: { campusId: 'kadikoy', location: LAB },
    recorded: { campusId: 'kadikoy', location: 'Müdür odası' },
  })
  const late = asset({ id: 'a-9', tagNumber: 'DB-2026-0009' })
  const plan = scan({ code: 'DB-2026-0009' }, { count: room, asset: late, item: null })
  assert.equal(plan.outcome, 'found')
  assert.equal(plan.outcome === 'found' ? plan.inScope : true, false)
})

test('DOM-FIN-087: ikinci okutma yeniden işaretlemez; ilk yer korunur (K-233)', () => {
  for (const result of ['found', 'misplaced'] as const)
    assert.deepEqual(
      scan(
        { code: 'DB-2026-0001', location: 'Başka oda' },
        { item: { result, inScope: true, recordedCampusId: 'kadikoy', recordedLocation: LAB } },
      ),
      { outcome: 'already_counted' },
    )
})

test('DOM-FIN-087: okutma reddi: kapalı sayım, eksik konum, olmayan kampüs, bilinmeyen ve hurda kod (K-233, K-234)', () => {
  for (const status of ['completed', 'cancelled'] as const)
    assert.throws(
      () =>
        scan(
          { code: 'DB-2026-0001', location: LAB },
          { count: { status, scopeType: 'institution', campusId: null, location: null } },
        ),
      isDomainError('fixed_asset_count_closed'),
    )
  assert.throws(
    () => scan({ code: 'DB-2026-0001' }),
    isDomainError('fixed_asset_count_location_required'),
  )
  assert.throws(
    () => scan({ code: 'DB-2026-0001', campusId: 'yok', location: LAB }, { campusFound: false }),
    isDomainError('fixed_asset_campus_not_found'),
  )
  assert.throws(
    () => scan({ code: 'BASKA-KURUM-1', location: LAB }, { asset: null, item: null }),
    isDomainError('fixed_asset_count_code_unknown'),
  )
  assert.throws(
    () => scan({ code: 'DB-2026-0004', location: LAB }, { asset: asset({ status: 'scrapped' }) }),
    isDomainError('fixed_asset_count_asset_scrapped'),
  )
})

test('DOM-FIN-087: yalnız açık sayım tamamlanır ya da iptal edilir (K-234)', () => {
  assert.doesNotThrow(() => planFixedAssetCountClose({ status: 'open' }))
  for (const status of ['completed', 'cancelled'] as const)
    assert.throws(
      () => planFixedAssetCountClose({ status }),
      isDomainError('fixed_asset_count_closed'),
    )
})

test('DOM-FIN-087: konum düzeltmesi yalnız tamamlanmış sayımda, yanlış konumdaki ve düzeltilmemiş demirbaşa (K-235)', () => {
  const checks = (
    overrides: Partial<FixedAssetCountRelocateChecks> = {},
  ): FixedAssetCountRelocateChecks => ({
    count: { status: 'completed' },
    item: {
      result: 'misplaced',
      relocatedAt: null,
      observedCampusId: 'moda',
      observedLocation: 'Kütüphane',
    },
    asset: { status: 'in_use' },
    campusFound: true,
    ...overrides,
  })
  assert.deepEqual(planFixedAssetCountRelocate(checks()), {
    campusId: 'moda',
    location: 'Kütüphane',
  })
  const item = checks().item
  const cases: [Partial<FixedAssetCountRelocateChecks>, string][] = [
    [{ count: { status: 'open' } }, 'fixed_asset_count_not_completed'],
    [{ count: { status: 'cancelled' } }, 'fixed_asset_count_not_completed'],
    [{ item: { ...item, result: 'found' } }, 'fixed_asset_count_item_not_misplaced'],
    [
      { item: { ...item, result: 'pending', observedLocation: null } },
      'fixed_asset_count_item_not_misplaced',
    ],
    [
      { item: { ...item, relocatedAt: '2026-10-06T10:00:00.000Z' } },
      'fixed_asset_count_item_relocated',
    ],
    [{ asset: { status: 'scrapped' } }, 'fixed_asset_scrapped'],
    [{ campusFound: false }, 'fixed_asset_campus_not_found'],
  ]
  for (const [overrides, code] of cases)
    assert.throws(() => planFixedAssetCountRelocate(checks(overrides)), isDomainError(code), code)
})

test('DOM-FIN-087: tamamlanmış sayımda okunmayan bulunamadı; açık ya da iptal sayımda okunmadı (K-235)', () => {
  assert.equal(fixedAssetCountOutcome('pending', 'completed'), 'missing')
  assert.equal(fixedAssetCountOutcome('pending', 'open'), 'pending')
  assert.equal(fixedAssetCountOutcome('pending', 'cancelled'), 'pending')
  assert.equal(fixedAssetCountOutcome('misplaced', 'completed'), 'misplaced')
  assert.equal(fixedAssetCountOutcome('found', 'cancelled'), 'found')
})

test('DOM-FIN-087: yer karşılaştırması ve kapsam adı', () => {
  assert.equal(
    sameFixedAssetPlace(
      { campusId: null, location: 'Şube' },
      { campusId: null, location: 'şube ' },
    ),
    true,
  )
  assert.equal(
    sameFixedAssetPlace({ campusId: 'a', location: 'Şube' }, { campusId: null, location: 'Şube' }),
    false,
  )
  assert.equal(
    fixedAssetCountScopeLabel({
      scopeType: 'institution',
      campusId: null,
      location: null,
      campusName: null,
    }),
    'Bütün kurum',
  )
  assert.equal(
    fixedAssetCountScopeLabel({
      scopeType: 'campus',
      campusId: 'k',
      location: null,
      campusName: 'Kadıköy',
    }),
    'Kadıköy',
  )
  assert.equal(
    fixedAssetCountScopeLabel({
      scopeType: 'campus',
      campusId: 'k',
      location: null,
      campusName: null,
    }),
    'Kampüs',
  )
  assert.equal(
    fixedAssetCountScopeLabel({
      scopeType: 'location',
      campusId: 'k',
      location: LAB,
      campusName: 'Kadıköy',
    }),
    `Kadıköy · ${LAB}`,
  )
  assert.equal(
    fixedAssetCountScopeLabel({
      scopeType: 'location',
      campusId: null,
      location: LAB,
      campusName: null,
    }),
    LAB,
  )
})

test("DOM-FIN-087: sonuç CSV'si sonuçları, yerleri ve okutma zamanını yazar; formül kaçılır", () => {
  const base: FixedAssetCountReportItem = {
    tagNumber: 'DB-2026-0001',
    assetName: 'Akıllı tahta',
    result: 'found',
    inScope: true,
    recordedCampusName: 'Kadıköy',
    recordedLocation: LAB,
    observedCampusName: 'Kadıköy',
    observedLocation: LAB,
    scannedAt: '2026-10-06T11:05:00.000Z',
    relocatedAt: null,
  }
  const csv = fixedAssetCountCsv('completed', [
    base,
    {
      ...base,
      tagNumber: 'DB-2026-0002',
      assetName: '=HYPERLINK("x")',
      result: 'pending',
      observedCampusName: null,
      observedLocation: null,
      scannedAt: null,
    },
    {
      ...base,
      tagNumber: 'DB-2026-0003',
      result: 'misplaced',
      inScope: false,
      observedCampusName: null,
      observedLocation: 'Depo',
      relocatedAt: '2026-10-07T08:00:00.000Z',
    },
  ])
  const lines = csv.trimEnd().split('\r\n')
  assert.equal(lines.length, 4)
  assert.equal(
    lines[0],
    '"Etiket";"Demirbaş";"Sonuç";"Kayıtlı yer";"Sayılan yer";"Beklenen listede";"Okutma zamanı";"Konum düzeltildi"',
  )
  assert.equal(
    lines[1],
    `"DB-2026-0001";"Akıllı tahta";"Bulundu";"Kadıköy · ${LAB}";"Kadıköy · ${LAB}";"Evet";"2026-10-06 14:05";""`,
  )
  assert.match(lines[2] ?? '', /"'=HYPERLINK\(""x""\)";"Bulunamadı";.*;"";"Evet";"";""$/)
  assert.match(lines[3] ?? '', /"Yanlış konumda";"Kadıköy · .*";"Depo";"Hayır";.*;"Evet"$/)
  assert.match(fixedAssetCountCsv('open', [{ ...base, result: 'pending' }]), /"Okunmadı"/)
})
