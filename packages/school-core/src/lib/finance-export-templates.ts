import type { FinanceExportKind } from './finance-export.ts'
import { defaultFinanceExportProfile, type ExportColumn } from './finance-export-profile.ts'

/**
 * Hazır sütun şablonları (ON-094, IST-111; DOM-FIN-055): yöneticinin başlangıç noktasıdır, forma
 * uygulanır ve kaydedilince kurumun profili olur. Bilinçli olarak geneldir: bir muhasebe programının
 * dosya biçimi örnek dosyayla doğrulanmadan "uyumlu" şablon eklenmez. Hesap kodu ve KDV sütunu
 * yoktur (**doğrulanmalı**, M-11); gereken kurum sabit sütunla kendisi ekler.
 */

export type ExportTemplateColumns = Readonly<Record<FinanceExportKind, readonly ExportColumn[]>>

export interface FinanceExportTemplate {
  id: string
  label: string
  description: string
  columns: ExportTemplateColumns
}

const column = (source: string, header: string): ExportColumn => ({ source, header })

export const FINANCE_EXPORT_TEMPLATES: readonly FinanceExportTemplate[] = [
  {
    id: 'standard',
    label: 'Standart',
    description: 'Bütün sütunlar, standart dosyanın başlıklarıyla.',
    columns: defaultFinanceExportProfile().columns,
  },
  {
    id: 'ledger',
    label: 'Genel kayıt',
    description: 'Her satırda tarih, belge, kişi ve tutar; ayrıntı sütunları sade başlıklarla.',
    columns: {
      payments: [
        column('date', 'Tarih'),
        column('receipt', 'Belge no'),
        column('type', 'İşlem türü'),
        column('studentName', 'Ad soyad'),
        column('studentNumber', 'Okul no'),
        column('method', 'Ödeme yöntemi'),
        column('reference', 'Referans'),
        column('amount', 'Tutar'),
      ],
      refunds: [
        column('date', 'Tarih'),
        column('studentName', 'Ad soyad'),
        column('studentNumber', 'Okul no'),
        column('accountHolder', 'Hesap sahibi'),
        column('maskedIban', 'IBAN'),
        column('amount', 'Tutar'),
      ],
      invoices: [
        column('date', 'Vade tarihi'),
        column('studentName', 'Ad soyad'),
        column('studentNumber', 'Okul no'),
        column('installment', 'Taksit no'),
        column('feeKind', 'Ücret kalemi'),
        column('status', 'Durum'),
        column('amount', 'Tutar'),
        column('paid', 'Ödenen tutar'),
      ],
    },
  },
  {
    id: 'compact',
    label: 'Kısa liste',
    description: 'Yalnız tarih, kişi ve tutar; hızlı karşılaştırma için.',
    columns: {
      payments: [
        column('date', 'Tarih'),
        column('studentName', 'Ad soyad'),
        column('amount', 'Tutar'),
      ],
      refunds: [
        column('date', 'Tarih'),
        column('studentName', 'Ad soyad'),
        column('amount', 'Tutar'),
      ],
      invoices: [
        column('date', 'Vade tarihi'),
        column('studentName', 'Ad soyad'),
        column('amount', 'Tutar'),
        column('paid', 'Ödenen tutar'),
      ],
    },
  },
]

export function financeExportTemplate(id: string): FinanceExportTemplate | undefined {
  return FINANCE_EXPORT_TEMPLATES.find((template) => template.id === id)
}
