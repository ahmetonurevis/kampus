import { SubmissionFileList } from '../learning/SubmissionFiles.tsx'
import { SummarySection } from '../management/SummaryParts.tsx'
import type { AbsenceRow } from './request-rows.ts'

/**
 * Özür belgeleri (DOM-ILT-053): dosya adı meta veriden okunur, dosya "Aç" denince kısa ömürlü
 * imzalı bağlantıyla açılır (her bağlantı denetim kaydıdır). Belge zorunlu değildir; yoksa bunu
 * söyler. Okuma yetkisi sunucudadır (veli, öğrenci, yönetici, sınıf rehber öğretmeni).
 */
export function AbsenceDocuments({ row }: { row: Pick<AbsenceRow, 'fileIds'> }) {
  return (
    <SummarySection title="Özür belgeleri">
      {row.fileIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belge eklenmedi.</p>
      ) : (
        <SubmissionFileList fileIds={row.fileIds} label="Özür belgeleri" />
      )}
    </SummarySection>
  )
}
