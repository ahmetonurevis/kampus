import { useMemo, useState } from 'react'
import { useImportStudents } from '@kampus/react-shared/use-enrollment-imports.ts'
import type { StudentImportResult } from '@kampus/react-shared/enrollment-imports.ts'
import { useAuth } from '@/auth/use-auth.ts'
import type { DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { EnrollmentImportDialog, noteColumn, statusColumn } from './EnrollmentImportDialog.tsx'
import {
  STUDENT_SAMPLE_CSV,
  STUDENT_SAMPLE_FILENAME,
  studentImportRow,
  studentImportSummary,
  type StudentImportTableRow,
} from './enrollment-import-rows.ts'

/** Sütunlar; kayıtlı kişi sütunu kurum türünün terimini taşır (DOM-KAY-012). */
const columnsFor = (learner: string): DataColumn<StudentImportTableRow>[] => [
  { key: 'line', label: 'Satır' },
  statusColumn<StudentImportTableRow>(),
  { key: 'name', label: learner },
  noteColumn<StudentImportTableRow>(),
  { key: 'classLabel', label: 'Sınıf' },
  { key: 'identity', label: 'Kimlik' },
  { key: 'guardian', label: 'Veli' },
  { key: 'guardianPhone', label: 'Veli telefonu' },
  { key: 'relationshipLabel', label: 'Yakınlık' },
]
const MOBILE_COLUMNS = ['line', 'name', 'status', 'noteText']
const SEARCH_KEYS = ['name', 'guardian', 'noteText']

const toRows = (result: StudentImportResult) => result.rows.map(studentImportRow)
const success = (result: StudentImportResult, learner: string) =>
  result.readyCount === 0 ? 'Yeni kayıt açılmadı.' : `${result.readyCount} ${learner} aktarıldı.`

/**
 * Kayıt İşlemleri → pilot verisi aktarımı (IST-007, ON-060; DOM-KAY-012, DOM-KAY-013): okul canlıya
 * geçerken mevcut öğrenci ve velilerini dosyadan yükler. Yalnız yönetici; başka rolde bölüm çizilmez.
 */
export function StudentImportSection() {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const importer = useImportStudents()
  const learner = useEnrollmentLearner()
  const columns = useMemo(() => columnsFor(learner.title), [learner])
  if (session?.role !== 'yonetici') return null
  return (
    <section
      aria-labelledby="ogrenci-aktarim-baslik"
      className="mt-6 grid gap-3 rounded-xl border bg-surface-soft p-4 sm:flex sm:items-center sm:justify-between"
    >
      <div>
        <h2 id="ogrenci-aktarim-baslik" className="text-base font-semibold">
          Mevcut {learner.plural}i aktar
        </h2>
        <p className="text-sm text-muted-foreground">
          Canlıya geçerken kayıtlı {learner.noun} ve velileri CSV ya da Excel dosyasıyla yükleyin.
        </p>
      </div>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Icon name="Upload" size={16} aria-hidden="true" />
        {learner.title} ve veli aktar
      </Button>
      <EnrollmentImportDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${learner.title} ve veli aktar`}
        description="Önce önizlenir; onaylayana kadar hiçbir kayıt yazılmaz."
        help={
          <>
            Başlık satırı zorunludur: <code>öğrenci adı</code>, <code>sınıf</code>,{' '}
            <code>kimlik no</code>, <code>doğum tarihi</code>, <code>veli adı</code>,{' '}
            <code>veli telefonu</code>, <code>yakınlık</code> (Anne, Baba, Vasi, Diğer); isteğe
            bağlı <code>kampüs</code>, <code>kimlik türü</code>, <code>öğrenci telefonu</code>. En
            çok 1.000 satır. Aynı telefon ve veli adı kardeşleri aynı veli kaydına bağlar;
            önizlemede görür, onayla kabul edersiniz. Kimliği kayıtlı {learner.noun} atlanır.
            Sözleşme ve taksit açılmaz, veliye bildirim gitmez.
          </>
        }
        noun={learner.title}
        listKey="ogrenci-aktarim"
        sampleCsv={STUDENT_SAMPLE_CSV}
        sampleFilename={STUDENT_SAMPLE_FILENAME}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        searchKeys={SEARCH_KEYS}
        submit={importer.submit}
        pending={importer.isPending}
        toRows={toRows}
        summary={(result) => studentImportSummary(result, learner.noun)}
        successMessage={(result) => success(result, learner.noun)}
      />
    </section>
  )
}
