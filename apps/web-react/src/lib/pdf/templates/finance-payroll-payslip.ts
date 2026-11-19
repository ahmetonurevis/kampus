// Ücret hesap pusulası (DOM-FIN-119; ON-201, K-406…K-408): ayın kayıtlı bordro hesabından personel
// başına pusula. Veri pusula ucundan gelir (her üretim denetime düşer, taze oturum); burada yeniden
// hesaplanmaz. Toplu belgede her personelin pusulası ayrı belge olarak kurulur ve sayfaları arka
// arkaya eklenir: her pusula kendi sayfasında başlar, sayfa numarası ve belge no pusulaya aittir.
import type {
  PayrollPayslip,
  PayrollPayslips,
} from '@kampus/react-shared/use-finance-payroll-runs.ts'
import { payrollEarningLabel } from '@kampus/school-core/lib/finance-payroll-calc.ts'
import {
  PAYROLL_PAYSLIP_NOTE,
  PAYROLL_PAYSLIP_UNAPPROVED_NOTE,
  payslipDeductionLabels,
  payslipStatutoryCents,
} from '@kampus/school-core/lib/finance-payroll-payslips.ts'
import { payrollMonthLabel } from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { sgkMonthRange, sgkRoleLabel } from '@kampus/school-core/lib/finance-sgk-preparation.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { COLORS, DocumentLayout, PAGE, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const PAYROLL_PAYSLIP_TITLE = 'Ücret hesap pusulası'

type Line = { label: string; value: string; strong?: boolean }
type Block = { title: string; lines: Line[] }

const COLUMN_WIDTH = 83
const COLUMN_STEP = 91
const LINE_SIZE = 9
const LINE_STEP = 4
const LINE_GAP = 1
const BLOCK_TITLE_HEIGHT = 8
const FACT_COLUMNS = 4
const FACT_HEIGHT = 12

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const minus = (cents: number) => (cents === 0 ? money(0) : `−${money(cents)}`)
const signed = (cents: number) => (cents < 0 ? `−${money(-cents)}` : money(cents))

/** Dosya adı: tek pusulada personelin adı ASCII'ye indirilir; toplu belgede ay. */
export function payrollPayslipFilename(data: Pick<PayrollPayslips, 'month' | 'payslips'>) {
  const [only] = data.payslips
  if (data.payslips.length !== 1 || only === undefined) return `bordro-pusulalari-${data.month}.pdf`
  const slug = only.name
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `bordro-pusulasi-${data.month}${slug ? `-${slug}` : ''}.pdf`
}

/** "G 16 Eki 2026 · Ç 20 Eki 2026"; ay içinde giriş/çıkış yoksa tire. */
function entryExitText(slip: PayrollPayslip): string {
  const parts = [
    slip.entryDate === null ? null : `Giriş ${dayText(slip.entryDate)}`,
    slip.exitDate === null ? null : `Çıkış ${dayText(slip.exitDate)}`,
  ].filter((part) => part !== null)
  return parts.length === 0 ? '—' : parts.join(' · ')
}

/** Brüt kalemler ve matrahlar (sol sütun). */
export function payslipEarningBlocks(slip: PayrollPayslip): Block[] {
  return [
    {
      title: 'Kazançlar',
      lines: [
        ...slip.earnings.map((earning) => ({
          label: payrollEarningLabel(earning),
          value: signed(earning.amountCents),
        })),
        { label: 'Brüt kazanç', value: money(slip.grossCents), strong: true },
      ],
    },
    {
      title: 'Matrahlar',
      lines: [
        { label: 'SGK matrahı', value: money(slip.sgkBaseCents) },
        { label: 'Gelir vergisi matrahı', value: money(slip.incomeTaxBaseCents) },
        {
          label: 'Önceki kümülatif GV matrahı',
          value: money(slip.cumulativeIncomeTaxBaseBeforeCents),
        },
        {
          label: 'Kümülatif GV matrahı (bu ay dahil)',
          value: money(slip.cumulativeIncomeTaxBaseCents),
        },
        { label: 'Damga vergisi matrahı', value: money(slip.stampTaxBaseCents) },
      ],
    },
  ]
}

/** Yasal kesintiler, net ve diğer kesintiler (sağ sütun). */
export function payslipDeductionBlocks(slip: PayrollPayslip): Block[] {
  const labels = payslipDeductionLabels(slip.deductions)
  const others: Line[] = [
    ...(slip.netAdjustmentCents === 0
      ? []
      : [{ label: 'Net düzeltme', value: signed(slip.netAdjustmentCents) }]),
    ...slip.deductions.map((line, index) => ({
      label: labels[index] ?? '',
      value: minus(line.amountCents),
    })),
  ]
  return [
    {
      title: 'Yasal kesintiler',
      lines: [
        { label: 'SGK işçi payı', value: minus(slip.sgkEmployeeCents) },
        { label: 'İşsizlik sigortası işçi payı', value: minus(slip.unemploymentEmployeeCents) },
        { label: 'Hesaplanan gelir vergisi', value: money(slip.incomeTaxCents) },
        { label: 'Asgari ücret GV istisnası', value: minus(slip.incomeTaxExemptionCents) },
        { label: 'Gelir vergisi', value: minus(slip.incomeTaxPayableCents) },
        { label: 'Hesaplanan damga vergisi', value: money(slip.stampTaxCents) },
        { label: 'Asgari ücret DV istisnası', value: minus(slip.stampTaxExemptionCents) },
        { label: 'Damga vergisi', value: minus(slip.stampTaxPayableCents) },
        {
          label: 'Yasal kesintiler toplamı',
          value: minus(payslipStatutoryCents(slip)),
          strong: true,
        },
      ],
    },
    {
      title: 'Net ücret ve kesintiler',
      lines: [
        { label: 'Net ücret', value: money(slip.netCents), strong: true },
        ...(others.length === 0
          ? [{ label: 'Avans, icra ve BES kesintisi yok', value: '' }]
          : others),
        ...(slip.deductions.length === 0
          ? []
          : [{ label: 'Kesinti toplamı', value: minus(slip.deductionCents), strong: true }]),
      ],
    },
  ]
}

/** Etiket/değer çiftlerini dört sütunlu sık bir ızgaraya yazar (pusula tek sayfaya sığsın). */
function facts(doc: DocumentLayout, items: readonly (readonly [string, string])[]) {
  const step = PAGE.contentWidth / FACT_COLUMNS
  for (let start = 0; start < items.length; start += FACT_COLUMNS) {
    const row = items.slice(start, start + FACT_COLUMNS)
    const wrapped = row.map(([, value]) => doc.wrap(value, step - 4, 9))
    const height = FACT_HEIGHT + (Math.max(...wrapped.map((lines) => lines.length)) - 1) * 4.5
    doc.ensure(height)
    row.forEach(([label], column) => {
      const x = PAGE.left + column * step
      doc.text(label, x, doc.y + 3, 7, COLORS.muted)
      wrapped[column]?.forEach((line, index) => doc.text(line, x, doc.y + 8.5 + index * 4.5, 9))
    })
    doc.y += height
  }
  doc.y += 2
}

function blockHeight(doc: DocumentLayout, blocks: readonly Block[]): number {
  return blocks.reduce(
    (total, block) =>
      total +
      BLOCK_TITLE_HEIGHT +
      block.lines.reduce(
        (sum, line) =>
          sum + doc.wrap(line.label, COLUMN_WIDTH - 32, LINE_SIZE).length * LINE_STEP + LINE_GAP,
        0,
      ),
    0,
  )
}

function drawBlocks(doc: DocumentLayout, blocks: readonly Block[], x: number, top: number) {
  let y = top
  for (const block of blocks) {
    doc.text(block.title, x, y + 5, 10, COLORS.sapphire)
    doc.rule(y + 7, x, COLUMN_WIDTH)
    y += BLOCK_TITLE_HEIGHT
    for (const line of block.lines) {
      const labels = doc.wrap(line.label, COLUMN_WIDTH - 32, LINE_SIZE)
      const color = line.strong ? COLORS.sapphire : COLORS.ink
      labels.forEach((part, index) =>
        doc.text(part, x, y + 4 + index * LINE_STEP, LINE_SIZE, color),
      )
      doc.text(line.value, x + COLUMN_WIDTH, y + 4, LINE_SIZE, color, 'right')
      y += labels.length * LINE_STEP + LINE_GAP
    }
  }
}

/** İki sütunlu döküm: solda kazançlar ve matrahlar, sağda kesintiler; ikisi aynı üst çizgiden. */
function ledger(doc: DocumentLayout, left: readonly Block[], right: readonly Block[]) {
  const height = Math.max(blockHeight(doc, left), blockHeight(doc, right))
  doc.ensure(height)
  const top = doc.y
  drawBlocks(doc, left, PAGE.left, top)
  drawBlocks(doc, right, PAGE.left + COLUMN_STEP, top)
  doc.y = top + height + 4
}

/** Tek personelin pusulası (kendi sayfasında başlar). */
export function payrollPayslipDocument(
  measurer: TextMeasurer,
  data: Omit<PayrollPayslips, 'payslips'>,
  slip: PayrollPayslip,
  options: TemplateOptions,
): PdfDocument {
  const range = sgkMonthRange(data.month)
  const doc = new DocumentLayout(measurer, {
    label: 'ÜCRET HESAP PUSULASI',
    badge: 'BORDRO',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `bordro-${data.month}-r${String(data.revision)}-${slip.membershipId.slice(0, 8)}`,
    footerNote: 'Mali müşavir doğrulaması bekler; resmî beyanname ve bildirge yerine geçmez.',
  })
  doc.heading(PAYROLL_PAYSLIP_TITLE, payrollMonthLabel(data.month))
  facts(doc, [
    ['PERSONEL', slip.name],
    ['GÖREV', sgkRoleLabel(slip.role)],
    ['DÖNEM', `${dayText(range.firstDay)} – ${dayText(range.lastDay)}`],
    ['İŞE GİRİŞ / ÇIKIŞ', entryExitText(slip)],
    ['ÇALIŞMA / PRİM GÜNÜ', String(slip.primDays)],
    ['EKSİK GÜN', String(slip.missingDays)],
    [
      'HESAP',
      `${String(data.revision)}. revizyon, ${dateLabel(data.calculatedAt, { year: 'numeric' })}`,
    ],
    ['DÖNEM ONAYI', data.locked ? 'Onaylı' : 'Onaylanmadı'],
  ])
  ledger(doc, payslipEarningBlocks(slip), payslipDeductionBlocks(slip))
  doc.metrics([
    ['BRÜT', money(slip.grossCents)],
    ['YASAL KESİNTİ', money(payslipStatutoryCents(slip))],
    ['NET ÜCRET', money(slip.netCents)],
    ['ÖDENECEK NET', money(slip.payableCents)],
  ])
  doc.paragraph(
    data.locked
      ? PAYROLL_PAYSLIP_NOTE
      : `${PAYROLL_PAYSLIP_UNAPPROVED_NOTE} ${PAYROLL_PAYSLIP_NOTE}`,
    8,
    COLORS.muted,
  )
  doc.signatures('İşveren / düzenleyen', 'Teslim alan personel', true)
  return doc.finish()
}

/**
 * Pusula belgesi: yanıttaki her personel için ayrı pusula; toplu belgede sayfalar arka arkaya
 * eklenir (her pusula yeni sayfada başlar). Boş yanıt uçta 404 olduğundan burada beklenmez.
 */
export function payrollPayslipsDocument(
  measurer: TextMeasurer,
  data: PayrollPayslips,
  options: TemplateOptions,
): PdfDocument {
  const { payslips, ...run } = data
  const documents = payslips.map((slip) => payrollPayslipDocument(measurer, run, slip, options))
  const [only] = payslips
  return {
    pages: documents.flatMap((document) => document.pages),
    metadata: {
      title:
        payslips.length === 1 && only !== undefined
          ? `${PAYROLL_PAYSLIP_TITLE} · ${only.name}`
          : `${PAYROLL_PAYSLIP_TITLE} · ${payrollMonthLabel(data.month)}`,
      author: options.institution,
      subject: 'Kampüs belgesi',
      creator: 'Kampüs',
    },
  }
}
