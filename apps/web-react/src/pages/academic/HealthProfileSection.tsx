import { useId, useState } from 'react'
import {
  HEALTH_EMERGENCY_NOTE,
  HEALTH_PRIVACY_NOTE,
  HEALTH_SECTION_TITLE,
  canEditHealthProfile,
  healthPanelMode,
  healthSectionState,
  healthViewSections,
  legalBasisLabel,
  type HealthProfileData,
  type HealthViewSection,
} from '@kampus/react-shared/health-profile-model.ts'
import {
  useHealthProfile,
  useUpdateHealthProfile,
} from '@kampus/react-shared/use-health-profile.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { notify } from '@/lib/notify.ts'
import { HealthProfileForm } from './HealthProfileForm.tsx'

/**
 * Öğrencinin sağlık ve acil bilgisi (OG-090; DOM-ILT-035, DOM-YTK-052). Düzeyi sunucu belirler:
 * `emergency` (derse giren öğretmen) yalnız alerjiler ve acil talimattan oluşan salt okunur kısa
 * karttır; `full` okuma görünümüdür ve yazma yetkisi olan rolde (yönetici, veli, 18+ öğrenci)
 * düzenlenir. 403/404'te (ön büro, ilgisiz öğretmen, kısıtlı veli, reşit olmayan öğrencinin kendisi)
 * bölüm hiç çizilmez ve hata toast'u çıkmaz. Veri yalnız sorgu önbelleğinde durur; kalıcı depoya
 * ve adrese yazılmaz (kvkk: Ö). Her görüntüleme sunucuda denetim kaydına yazılır.
 */
export function HealthProfileSection({
  studentId,
  studentName,
}: {
  studentId: string
  /** Veli birden çok çocukta hangisinin bilgisi olduğunu başlıkta görür. */
  studentName?: string
}) {
  const { session } = useAuth()
  const query = useHealthProfile(studentId)
  const state = healthSectionState({
    data: query.data,
    error: query.error,
    isPending: query.isPending,
  })
  if (state === 'hidden') return null
  const title = studentName ? `${HEALTH_SECTION_TITLE} — ${studentName}` : HEALTH_SECTION_TITLE
  return (
    <SectionFrame title={title}>
      {state === 'loading' ? (
        <p role="status" className="text-sm text-muted-foreground">
          Sağlık bilgisi yükleniyor…
        </p>
      ) : state === 'error' ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data ? (
        <HealthProfileBody
          key={studentId}
          studentId={studentId}
          data={query.data.data}
          canWrite={session ? canEditHealthProfile(session.role) : false}
        />
      ) : null}
    </SectionFrame>
  )
}

function SectionFrame({
  title,
  children,
  note,
}: {
  title: string
  children: React.ReactNode
  note?: React.ReactNode
}) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className="panel mb-6 rounded-card border bg-surface px-6 py-5 max-[650px]:px-4"
    >
      <h2
        id={headingId}
        className="mb-3 flex items-center gap-2 text-md font-semibold [overflow-wrap:anywhere]"
      >
        <Icon name="ShieldAlert" size={18} aria-hidden="true" />
        {title}
      </h2>
      {note}
      {children}
    </section>
  )
}

function HealthProfileBody({
  studentId,
  data,
  canWrite,
}: {
  studentId: string
  data: HealthProfileData
  canWrite: boolean
}) {
  const [editing, setEditing] = useState(false)
  const save = useUpdateHealthProfile(studentId, {
    onSuccess: () => {
      notify.success('Sağlık bilgisi kaydedildi.')
      setEditing(false)
    },
  })
  const mode = healthPanelMode(data, canWrite)

  if (mode === 'emergency')
    return (
      <>
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge text={HEALTH_EMERGENCY_NOTE} tone="amber" />
          Diğer sağlık bilgileri bu görünümde yer almaz.
        </p>
        <HealthSections sections={healthViewSections(data)} />
      </>
    )

  if (data.level !== 'full') return null
  if (mode === 'editable' && editing)
    return (
      <HealthProfileForm
        data={data}
        pending={save.isPending}
        onCancel={() => setEditing(false)}
        onSave={(patch, setError) => save.submit(patch, { setError })}
      />
    )

  const basis = data.profile.legalBasis
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{HEALTH_PRIVACY_NOTE}</p>
      <HealthSections sections={healthViewSections(data)} />
      <p className="mt-3 text-xs text-muted-foreground">
        {basis ? `Hukuki dayanak: ${legalBasisLabel(basis)}` : 'Henüz kayıt girilmemiş.'}
        {data.profile.updatedAt
          ? ` · Son güncelleme: ${dateLabel(data.profile.updatedAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
          : ''}
      </p>
      {mode === 'editable' ? (
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            <Icon name="Pencil" size={16} aria-hidden="true" />
            Sağlık bilgisini düzenle
          </Button>
        </div>
      ) : null}
    </>
  )
}

function HealthSections({ sections }: { sections: readonly HealthViewSection[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {sections.map((section) => (
        <div key={section.key} className="rounded-card border bg-surface-soft px-4 py-3">
          <dt className="mb-2 text-xs font-medium text-muted-foreground">{section.title}</dt>
          <dd>
            {section.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{section.empty}</p>
            ) : (
              <ul className="grid gap-1.5 text-sm">
                {section.items.map((item) => (
                  <li key={item.key} className="flex flex-wrap items-center gap-2">
                    <span className="[overflow-wrap:anywhere]">{item.label}</span>
                    {item.detail ? (
                      <StatusBadge text={item.detail} tone={item.urgent ? 'red' : 'gray'} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
