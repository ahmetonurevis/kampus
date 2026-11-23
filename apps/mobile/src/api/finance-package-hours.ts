// Öğrencinin kalan paket saati bölümünün açılma kararı (ON-302, K-24). Satır görünümü web ile aynı
// katmandadır (`@kampus/react-shared/finance-package-hours.ts`). Kapsamı sunucu uygular; buradaki
// karar yalnız boşuna istek atılmasın ve bölüm yanlış rolde görünmesin diyedir.
import { isModuleOpen, type MobileSession } from './session-state.ts'

/** Bölüm açılacaksa öğrenci kaydı, açılmayacaksa `null`: yalnız dil okulu öğrencisi, finans modülü açık. */
export function ownPackageHoursStudent(
  session: Pick<MobileSession, 'role' | 'studentId' | 'institution' | 'modules'>,
): string | null {
  if (session.role !== 'ogrenci' || session.institution.type !== 'language_school') return null
  return isModuleOpen(session.modules, 'finance') ? session.studentId : null
}
