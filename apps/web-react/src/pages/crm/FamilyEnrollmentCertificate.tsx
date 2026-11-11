import { useAuth } from '@/auth/use-auth.ts'
import { enrollmentCertificateTitle } from '@/lib/pdf/templates/enrollment-certificate.ts'
import { EnrollmentCertificateButton } from './EnrollmentCertificateButton.tsx'

/**
 * Velinin seçili çocuğu ya da öğrencinin kendisi için belge satırı (K-32, DOM-KAY-027). Veri
 * okumaz: belge yalnız düğmeyle düzenlenir, çünkü her düzenleme denetim kaydıdır. Kapsam sunucudadır;
 * ayrılan ve mezun öğrencide sunucunun Türkçe iletisi önizleme penceresinde görünür.
 */
export function FamilyEnrollmentCertificate({ studentId }: { studentId: string }) {
  const { session } = useAuth()
  const title = enrollmentCertificateTitle(session?.institution.type)
  return (
    <section
      aria-label={title}
      className="panel mb-6 flex flex-wrap items-center justify-between gap-4 rounded-card border bg-surface px-6 py-5"
    >
      <p className="max-w-[62ch] min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
        Kaydın aktif olduğunu gösteren kurum belgesi. Bilgilendirme amaçlıdır, resmî belge yerine
        geçmez; her düzenleme işlem geçmişine yazılır.
      </p>
      <EnrollmentCertificateButton studentId={studentId} audience="family" />
    </section>
  )
}
