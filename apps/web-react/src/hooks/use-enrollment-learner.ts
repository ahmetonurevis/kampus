import { learnerWords, type LearnerWords } from '@kampus/school-core/lib/enrollment-learner.ts'
import { useAuth } from '@/auth/use-auth.ts'

/**
 * Etkin kurumun kayıtlı kişi sözleri (DOM-KAY-012, ADR 0008 karar 1): okulda "öğrenci", dil okulu
 * ve kursta "kursiyer". Kayıt ve finans ekranlarının etiket, boş durum ve bildirim metinleri
 * buradan yazılır; oturum yüklenmeden okul sözleri döner.
 */
export function useEnrollmentLearner(): LearnerWords {
  const { session } = useAuth()
  return learnerWords(session?.institution.type)
}
