import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHEMICAL_EXPIRY_WARNING_DAYS,
  chemicalExpiry,
  chemicalInventoryCsv,
  chemicalInventoryRows,
  chemicalLotBalances,
  chemicalProfileSchema,
  hasSafetyDataSheet,
  isChemicalAttention,
  isValidCasNumber,
  lotLabel,
  pictogramsText,
  planChemicalProfile,
  planChemicalProfileUpdate,
  type ChemicalItem,
  type LotMovement,
  type MovementLot,
} from '../packages/school-core/src/lib/finance-chemicals.ts'
import {
  planStockEntry,
  type StockItemRef,
  type StockMovementContext,
  type StockWarehouseRef,
} from '../packages/school-core/src/lib/finance-inventory.ts'

import { isDomainError } from './support/domain-error.ts'

// Laboratuvar kimyasal envanteri (DOM-FIN-090; ON-234; K-240…K-243).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const ACID = '00000000-0000-4000-8000-0000000000a1'
const PAPER = '00000000-0000-4000-8000-0000000000a2'
const LAB = '00000000-0000-4000-8000-0000000000c1'
const ANNEX = '00000000-0000-4000-8000-0000000000c2'
const TODAY = '2026-10-06'

const ITEMS = new Map<string, StockItemRef>([
  [ACID, { id: ACID, code: 'HCL', name: 'Hidroklorik asit', unit: 'liter', isActive: true }],
  [PAPER, { id: PAPER, code: 'KAG', name: 'A4 kâğıt', unit: 'pack', isActive: true }],
])
const WAREHOUSES = new Map<string, StockWarehouseRef>([
  [LAB, { id: LAB, name: 'Laboratuvar', campusId: 'b1', isActive: true }],
])
const context = (extra: Partial<StockMovementContext> = {}): StockMovementContext => ({
  items: ITEMS,
  warehouses: WAREHOUSES,
  movements: [],
  today: TODAY,
  chemicalItemIds: new Set([ACID]),
  ...extra,
})
const entry = (extra: Record<string, unknown> = {}) => ({
  itemId: ACID,
  warehouseId: LAB,
  quantity: 5,
  movementDate: '2026-10-01',
  reason: 'opening',
  lotNumber: 'L-24/115',
  expiryDate: '2027-01-31',
  ...extra,
})

test('DOM-FIN-090: CAS numarası biçim ve sağlama basamağıyla denetlenir', () => {
  for (const valid of ['7732-18-5', '7647-01-0', '64-17-5', '50-00-0', '7440-57-5'])
    assert.equal(isValidCasNumber(valid), true, valid)
  for (const invalid of ['7732-18-4', '7732185', '1-18-5', '12345678-12-1', '7732-1-5', ''])
    assert.equal(isValidCasNumber(invalid), false, invalid)
})

test('DOM-FIN-090, K-240: kimyasal bilgisi şeması; piktogram tekilleşir ve sıralanır, boş metin boş olur', () => {
  const data = chemicalProfileSchema.parse({
    hazardPictograms: ['GHS07', 'GHS05', 'GHS05'],
    signalWord: 'danger',
    casNumber: ' 7647-01-0 ',
    storageClass: '',
    sdsUrl: 'https://tedarikci.example/gbf/hcl.pdf',
  })
  assert.deepEqual(data.hazardPictograms, ['GHS05', 'GHS07'])
  assert.equal(data.casNumber, '7647-01-0')
  assert.equal(data.storageClass, null)
  assert.equal(data.sdsDocumentNumber, null)
  assert.deepEqual(chemicalProfileSchema.parse({}).hazardPictograms, [])
  const issue = (input: unknown) => {
    const result = chemicalProfileSchema.safeParse(input)
    assert.equal(result.success, false)
    return result.error?.issues[0]
  }
  assert.match(issue({ casNumber: '7647-01-1' })?.message ?? '', /sağlama basamağı/)
  assert.match(issue({ casNumber: '7647011' })?.message ?? '', /biçiminde/)
  assert.deepEqual(issue({ hazardPictograms: ['GHS10'] })?.path, ['hazardPictograms', 0])
  assert.match(issue({ sdsUrl: 'http://example.com/gbf' })?.message ?? '', /https/)
  assert.match(issue({ sdsUrl: 'gbf.pdf' })?.message ?? '', /https/)
  assert.equal(issue({ signalWord: 'caution' })?.path?.[0], 'signalWord')
  assert.equal(issue({ extra: true })?.code, 'unrecognized_keys')
})

test('DOM-FIN-090, K-240: kimyasal bilgisi kartta bir kez açılır; GBF revizyonu gelecekte olamaz', () => {
  const data = planChemicalProfile(
    { hazardPictograms: ['GHS05'], sdsDocumentNumber: 'GBF-12', sdsRevisionDate: TODAY },
    { exists: false, today: TODAY },
  )
  assert.equal(hasSafetyDataSheet(data), true)
  assert.throws(
    () => planChemicalProfile({}, { exists: true, today: TODAY }),
    isDomainError('stock_item_chemical_exists', 'conflict'),
  )
  assert.throws(
    () => planChemicalProfile({ sdsRevisionDate: '2026-10-07' }, { exists: false, today: TODAY }),
    isDomainError('chemical_sds_date_future', 'rule'),
  )
  assert.deepEqual(planChemicalProfileUpdate({ signalWord: null }, { today: TODAY }), {
    signalWord: null,
  })
  assert.throws(() => planChemicalProfileUpdate({}, { today: TODAY }), ZodError)
  assert.throws(
    () => planChemicalProfileUpdate({ sdsRevisionDate: '2027-01-01' }, { today: TODAY }),
    isDomainError('chemical_sds_date_future', 'rule'),
  )
  assert.equal(hasSafetyDataSheet({ sdsUrl: null, sdsDocumentNumber: null }), false)
  assert.equal(pictogramsText([]), '—')
  assert.equal(pictogramsText(['GHS02', 'GHS07']), 'GHS02, GHS07')
})

test('DOM-FIN-090, K-241: kimyasal kartın girişi parti ve son kullanma ister; kimyasal olmayan kart parti almaz', () => {
  const data = planStockEntry(entry(), context())
  assert.equal(data.lotNumber, 'L-24/115')
  assert.equal(data.expiryDate, '2027-01-31')
  assert.throws(
    () => planStockEntry(entry({ lotNumber: null, expiryDate: null }), context()),
    isDomainError('stock_lot_required', 'rule'),
  )
  assert.throws(
    () => planStockEntry(entry({ itemId: PAPER }), context()),
    isDomainError('stock_lot_not_allowed', 'rule'),
  )
  // Kimyasal bağlamı verilmeyen eski çağrılar partisiz girişi bozmaz.
  const plain = planStockEntry(
    entry({ itemId: PAPER, lotNumber: undefined, expiryDate: undefined }),
    context({ chemicalItemIds: undefined }),
  )
  assert.equal(plain.lotNumber, null)
  assert.throws(() => planStockEntry(entry({ expiryDate: null }), context()), ZodError)
  assert.throws(() => planStockEntry(entry({ lotNumber: '' }), context()), ZodError)
  assert.throws(() => planStockEntry(entry({ lotNumber: 'A\u0007' }), context()), ZodError)
  assert.throws(() => planStockEntry(entry({ lotNumber: 'x'.repeat(41) }), context()), ZodError)
})

let sequence = 0
const move = (
  type: LotMovement['type'],
  quantity: number,
  movementDate: string,
  extra: Partial<LotMovement> = {},
): LotMovement => ({
  id: `m${String((sequence += 1)).padStart(3, '0')}`,
  itemId: ACID,
  warehouseId: LAB,
  type,
  quantity,
  movementDate,
  cancelledAt: null,
  transferId: null,
  createdAt: `${movementDate}T08:${String(sequence).padStart(2, '0')}:00.000Z`,
  ...extra,
})
const lotted = (lots: [LotMovement, MovementLot][]) => ({
  movements: lots.map(([movement]) => movement),
  lots: new Map(lots.map(([movement, lot]) => [movement.id, lot])),
})
const summary = (balances: ReturnType<typeof chemicalLotBalances>) =>
  balances.map((row) => [row.warehouseId === LAB ? 'lab' : 'annex', row.lotNumber, row.quantity])

test('DOM-FIN-090, K-242: çıkış en yakın son kullanma tarihli partiden düşer (FEFO); iptal edilen sayılmaz', () => {
  const late = move('in', 5, '2026-09-01')
  const early = move('in', 4, '2026-09-10')
  const { movements, lots } = lotted([
    [late, { lotNumber: 'B', expiryDate: '2027-06-30' }],
    [early, { lotNumber: 'A', expiryDate: '2026-12-31' }],
  ])
  const balances = chemicalLotBalances(
    [
      ...movements,
      move('out', 6, '2026-09-20'),
      move('out', 3, '2026-09-21', { cancelledAt: '2026-09-22T08:00:00.000Z' }),
    ],
    lots,
  )
  assert.deepEqual(summary(balances), [['lab', 'B', 3]])
  assert.equal(balances[0]?.firstDate, '2026-09-01')
})

test('DOM-FIN-090, K-242: aynı parti iki girişte birleşir; eşit son kullanmada önce giren düşer, partisiz en son', () => {
  const first = move('in', 2, '2026-09-01')
  const second = move('in', 3, '2026-09-02')
  const sameExpiry = move('in', 2, '2026-08-01')
  const { movements, lots } = lotted([
    [first, { lotNumber: 'A', expiryDate: '2027-01-31' }],
    [second, { lotNumber: 'A', expiryDate: '2027-01-31' }],
    [sameExpiry, { lotNumber: 'Z', expiryDate: '2027-01-31' }],
  ])
  const receipt = move('receipt', 4, '2026-08-15')
  const balances = chemicalLotBalances([...movements, receipt, move('out', 3, '2026-09-05')], lots)
  assert.deepEqual(summary(balances), [
    ['lab', 'A', 4],
    [`lab`, null, 4],
  ])
})

test('DOM-FIN-090, K-242: transfer çıkışta düşen partileri giriş deposuna taşır', () => {
  const a = move('in', 2, '2026-09-01')
  const b = move('in', 5, '2026-09-02')
  const { movements, lots } = lotted([
    [a, { lotNumber: 'A', expiryDate: '2026-11-30' }],
    [b, { lotNumber: 'B', expiryDate: '2027-03-31' }],
  ])
  const transfer = 't-1'
  const balances = chemicalLotBalances(
    [
      ...movements,
      // Giriş bacağı önce gelse de çıkış bacağıyla birlikte işlenir.
      move('transfer_in', 4, '2026-09-10', { warehouseId: ANNEX, transferId: transfer }),
      move('transfer_out', 4, '2026-09-10', { transferId: transfer }),
    ],
    lots,
  )
  assert.deepEqual(summary(balances), [
    ['lab', 'B', 3],
    ['annex', 'A', 2],
    ['annex', 'B', 2],
  ])
  const annexA = balances.find((row) => row.warehouseId === ANNEX && row.lotNumber === 'A')
  assert.equal(annexA?.firstDate, '2026-09-10')
})

test('DOM-FIN-090, K-242: aynı gün sonra yazılan girişten karşılanan çıkış gün sonunda partilerden kapanır', () => {
  const lot = move('in', 5, '2026-09-01')
  const later = move('in', 3, '2026-09-05', { createdAt: '2026-09-05T15:00:00.000Z' })
  const { movements, lots } = lotted([
    [lot, { lotNumber: 'A', expiryDate: '2027-01-31' }],
    [later, { lotNumber: 'B', expiryDate: '2026-12-31' }],
  ])
  const balances = chemicalLotBalances(
    [
      ...movements,
      // Gün sonu esası (K-181): sabah yazılan çıkış öğleden sonraki girişle karşılanmış sayılır.
      move('out', 7, '2026-09-05', { createdAt: '2026-09-05T09:00:00.000Z' }),
    ],
    lots,
  )
  assert.deepEqual(summary(balances), [['lab', 'B', 1]])
  // Transferin tek bacağı (diğeri yoksa) sıradan giriş ya da çıkış gibi işlenir.
  const orphan = chemicalLotBalances(
    [move('transfer_in', 2, '2026-09-06', { transferId: 'x' })],
    new Map(),
  )
  assert.deepEqual(summary(orphan), [['lab', null, 2]])
})

test('DOM-FIN-090, K-243: son kullanma günü kullanılabilir son gündür; 30 gün içinde dolan uyarıdadır', () => {
  assert.deepEqual(chemicalExpiry('2026-10-05', TODAY), { status: 'expired', daysLeft: -1 })
  assert.deepEqual(chemicalExpiry(TODAY, TODAY), { status: 'expiring', daysLeft: 0 })
  assert.deepEqual(chemicalExpiry('2026-11-05', TODAY), {
    status: 'expiring',
    daysLeft: CHEMICAL_EXPIRY_WARNING_DAYS,
  })
  assert.deepEqual(chemicalExpiry('2026-11-06', TODAY), { status: 'ok', daysLeft: 31 })
  assert.deepEqual(chemicalExpiry(null, TODAY), { status: 'unknown', daysLeft: null })
  assert.equal(isChemicalAttention('expired'), true)
  assert.equal(isChemicalAttention('expiring'), true)
  assert.equal(isChemicalAttention('ok'), false)
  assert.equal(isChemicalAttention('unknown'), false)
})

const ACID_ITEM: ChemicalItem = {
  id: ACID,
  code: 'HCL',
  name: 'Hidroklorik asit',
  unit: 'liter',
  hazardPictograms: ['GHS05', 'GHS07'],
  signalWord: 'danger',
  casNumber: '7647-01-0',
  storageClass: 'Asit dolabı',
  sdsUrl: null,
  sdsDocumentNumber: 'GBF-7',
}

test('DOM-FIN-090: envanter raporu depo × kimyasal, partiler ve son kullanma özetiyle; CSV parti başına satır', () => {
  const rows = chemicalInventoryRows({
    items: [ACID_ITEM, { ...ACID_ITEM, id: PAPER, code: 'ETANOL', name: '=Etanol' }],
    warehouses: [
      { id: LAB, name: 'Laboratuvar', campusName: 'Kadıköy', isActive: true },
      { id: ANNEX, name: 'Ana depo', campusName: null, isActive: false },
    ],
    lots: [
      {
        itemId: ACID,
        warehouseId: LAB,
        lotNumber: 'A',
        expiryDate: '2026-10-01',
        quantity: 2,
        firstDate: '2026-01-01',
      },
      {
        itemId: ACID,
        warehouseId: LAB,
        lotNumber: 'B',
        expiryDate: '2026-10-20',
        quantity: 3,
        firstDate: '2026-02-01',
      },
      {
        itemId: ACID,
        warehouseId: LAB,
        lotNumber: null,
        expiryDate: null,
        quantity: 1,
        firstDate: '2026-03-01',
      },
      {
        itemId: PAPER,
        warehouseId: ANNEX,
        lotNumber: 'E1',
        expiryDate: '2028-01-01',
        quantity: 4,
        firstDate: '2026-03-01',
      },
      {
        itemId: 'bilinmeyen',
        warehouseId: LAB,
        lotNumber: 'X',
        expiryDate: null,
        quantity: 1,
        firstDate: '2026-03-01',
      },
      {
        itemId: ACID,
        warehouseId: ANNEX,
        lotNumber: 'Z',
        expiryDate: null,
        quantity: 0,
        firstDate: '2026-03-01',
      },
    ],
    today: TODAY,
  })
  assert.deepEqual(
    rows.map((row) => [row.warehouseName, row.code, row.quantity]),
    [
      ['Ana depo', 'ETANOL', 4],
      ['Laboratuvar', 'HCL', 6],
    ],
  )
  const acid = rows[1]
  assert.equal(acid?.expiredQuantity, 2)
  assert.equal(acid?.expiringQuantity, 3)
  assert.equal(acid?.nearestExpiryDate, '2026-10-01')
  assert.equal(acid?.hasSds, true)
  assert.deepEqual(
    acid?.lots.map((lot) => [lotLabel(lot), lot.status, lot.daysLeft]),
    [
      ['A', 'expired', -5],
      ['B', 'expiring', 14],
      ['Parti bilgisi yok', 'unknown', null],
    ],
  )
  const csv = chemicalInventoryCsv(rows)
  const lines = csv.trimEnd().split('\r\n')
  assert.equal(lines.length, 5)
  assert.equal(
    lines[0],
    '"Depo";"Kampüs";"Kod";"Kimyasal";"CAS";"Piktogramlar";"Sinyal kelimesi";"Depolama sınıfı";"GBF";"Parti";"Son kullanma";"Durum";"Miktar";"Birim"',
  )
  // Formül enjeksiyonu kaçılır; piktogramlar kod olarak yazılır.
  assert.match(
    lines[1] ?? '',
    /^"Ana depo";"";"ETANOL";"'=Etanol";"7647-01-0";"GHS05, GHS07";"Tehlike"/,
  )
  assert.match(lines[2] ?? '', /"A";"2026-10-01";"Süresi geçti";2;"litre"$/i)
  assert.match(lines[4] ?? '', /"Parti bilgisi yok";"";"Parti bilgisi yok";1;/)
})
