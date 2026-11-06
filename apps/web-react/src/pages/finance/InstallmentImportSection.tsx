import { useState } from 'react'
import type { InstallmentImportResult } from '@kampus/react-shared/enrollment-imports.ts'
import { useImportInstallments } from '@kampus/react-shared/use-enrollment-imports.ts'
import type { DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { EnrollmentImportDialog, noteColumn, statusColumn } from '../crm/EnrollmentImportDialog.tsx'
import {
  INSTALLMENT_SAMPLE_CSV,
  INSTALLMENT_SAMPLE_FILENAME,
  installmentImportRow,
  installmentImportSummary,
  type InstallmentImportTableRow,
} from '../crm/enrollment-import-rows.ts'

const COLUMNS: DataColumn<InstallmentImportTableRow>[] = [
  { key: 'line', label: 'Satır' },
  statusColumn<InstallmentImportTableRow>(),
  { key: 'student', label: 'Öğrenci' },
  noteColumn<InstallmentImportTableRow>(),
  { key: 'identity', label: 'Kimlik' },
  { key: 'installment', label: 'Taksit' },
  { key: 'amount', label: 'Tutar' },
  { key: 'due', label: 'Vade' },
  { key: 'paid', label: 'Ödeme' },
  { key: 'contract', label: 'Sözleşme' },
]
const MOBILE_COLUMNS = ['line', 'student', 'amount', 'status', 'noteText']
const SEARCH_KEYS = ['student', 'noteText']

const toRows = (result: InstallmentImportResult) => result.rows.map(installmentImportRow)
const success = (result: InstallmentImportResult) =>
  result.readyCount === 0 ? 'Yeni taksit açılmadı.' : `${result.readyCount} taksit aktarıldı.`

/**
 * Finans → taksit aktarımı (IST-007, ON-061; DOM-FIN-011, DOM-FIN-012, ADR 0010 cevap 3): okul
 * canlıya geçerken açık ve ödenmiş taksitlerini yükler. Yalnız yönetici; sayfa `canManage` verir.
 */
export function InstallmentImportSection() {
  const [open, setOpen] = useState(false)
  const importer = useImportInstallments()
  return (
    <section
      aria-labelledby="taksit-aktarim-baslik"
      className="mt-6 grid gap-3 rounded-xl border bg-surface-soft p-4 sm:flex sm:items-center sm:justify-between"
    >
      <div>
        <h2 id="taksit-aktarim-baslik" className="text-base font-semibold">
          Mevcut taksitleri aktar
        </h2>
        <p className="text-sm text-muted-foreground">
          Canlıya geçerken açık ve ödenmiş taksitleri CSV ya da Excel dosyasıyla yükleyin. Önce
          öğrencileri Kayıt İşlemleri'nden aktarın.
        </p>
      </div>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Icon name="Upload" size={16} aria-hidden="true" />
        Taksit aktar
      </Button>
      <EnrollmentImportDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Taksit aktar"
        description="Önce önizlenir; onaylayana kadar hiçbir kayıt yazılmaz."
        help={
          <>
            Başlık satırı zorunludur: <code>kimlik no</code>, <code>taksit no</code>,{' '}
            <code>tutar</code> (TL: 12.500,00 ya da 12500.00; 1.234 gibi belirsiz yazım hatadır) ya
            da <code>tutar kuruş</code> (1250000), <code>vade</code>; isteğe bağlı{' '}
            <code>öğrenci adı</code>, <code>ödeme tarihi</code>, <code>eğitim yılı</code>. En çok
            5.000 satır. Öğrencinin tek sözleşmesi varsa taksit ona bağlanır, yoksa sözleşmesiz
            yazılır. Kayıtlı taksit atlanır. Ödeme tarihi yazılı taksit ödendi görünür ve Açılış
            aktarımı diye işaretlenir; kasaya ve dönem tahsilatına yazılmaz, dekontu olmaz.
            Dosyadaki ödeme yöntemi saklanmaz.
          </>
        }
        noun="Taksit"
        listKey="taksit-aktarim"
        sampleCsv={INSTALLMENT_SAMPLE_CSV}
        sampleFilename={INSTALLMENT_SAMPLE_FILENAME}
        columns={COLUMNS}
        mobileColumns={MOBILE_COLUMNS}
        searchKeys={SEARCH_KEYS}
        submit={importer.submit}
        pending={importer.isPending}
        toRows={toRows}
        summary={installmentImportSummary}
        successMessage={success}
      />
    </section>
  )
}
