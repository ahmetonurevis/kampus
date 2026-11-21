import { useState } from 'react'
import type { ConsentPurpose } from '@kampus/school-core/lib/consent-purposes.ts'
import {
  useConsents,
  useConsentStatus,
  useConsentTexts,
  useGiveConsent,
  useWithdrawConsent,
} from '@kampus/react-shared/use-consents.ts'
import { withChildNames } from '@/lib/child-selection.ts'
import type { Session } from '@/auth/auth-port.ts'
import { ConsentStep } from '@/components/consent/ConsentStep.tsx'
import {
  ACCOUNT_PURPOSES,
  STUDENT_PURPOSES,
  purposeLabel,
} from '@/components/consent/consent-model.ts'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useNow } from '@/hooks/use-now.ts'
import { notify } from '@/lib/notify.ts'
import {
  OBJECTION_COPY,
  WITHDRAW_COPY,
  consentRows,
  objectionCandidates,
  type ConsentRow,
} from './consent-rows.ts'

const NO_STUDENTS: ReadonlyArray<{ id: string; name: string }> = []
const NO_PURPOSES: readonly ConsentPurpose[] = []

/**
 * Rızalarım (IST-017; DOM-YTK-057…062): veli çocuk başına ve hesabı için, öğrenci kendisi için
 * rızaları (amaç, durum, tarih, metin sürümü) görür, yeni rıza verir ve tek işlemle geri çeker.
 * Rıza varsayılan değildir; vermemek temel eğitim hizmetini etkilemez. Verenin hesap kimliği
 * gösterilmez. Kapsam ve yaş/velayet kararı sunucudadır.
 */
export function ConsentsSection({ session }: { session: Session }) {
  const parent = session.role === 'veli'
  const students = useCoreAll('students', {}, { enabled: parent })
  const children = withChildNames(
    session.children,
    students.data?.map((row) => row.record) ?? NO_STUDENTS,
  )
  const ownStudentId = session.links.find((link) => link.kind === 'student')?.recordId

  return (
    <section
      aria-labelledby="rizalarim-baslik"
      className="panel rounded-card border bg-surface p-6"
    >
      <h2 id="rizalarim-baslik" className="text-lg font-semibold">
        Rızalarım
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        {parent
          ? 'Çocuklarınız için fotoğraf, video ve ses kaydı rızalarını buradan verir ve geri çekersiniz.'
          : '18 yaşından küçükseniz rızayı velayet sahibi veliniz verir; kayıtları buradan görürsünüz.'}{' '}
        Rıza vermek zorunlu değildir; vermemeniz temel eğitim hizmetini etkilemez.
      </p>
      <div className="grid gap-6">
        {parent ? (
          <>
            {children.map((child) =>
              child.name ? (
                <ConsentSubject
                  key={child.id}
                  title={child.name}
                  studentId={child.id}
                  purposes={STUDENT_PURPOSES}
                  session={session}
                />
              ) : null,
            )}
            <ConsentSubject
              title="Hesabım"
              purposes={ACCOUNT_PURPOSES}
              subjectKind="user"
              session={session}
            />
            <ConsentSubject
              title="Erişiminiz kalkan öğrenciler"
              description="Erişiminiz kalksa da daha önce verdiğiniz rızaları buradan geri çekebilirsiniz."
              purposes={NO_PURPOSES}
              subjectKind="student"
              hideWhenEmpty
              session={session}
            />
          </>
        ) : ownStudentId ? (
          <ConsentSubject
            title={session.user.name}
            studentId={ownStudentId}
            purposes={STUDENT_PURPOSES}
            session={session}
          />
        ) : null}
      </div>
    </section>
  )
}

/**
 * `studentId` olmadan liste velinin hesap rızalarıyla birlikte, erişimi kalkan (velayeti
 * kaldırılan, iletişimi kısıtlanan) öğrenciler için kendi verdiği açık rızaları da getirir
 * (KVKK m.11; DOM-YTK-059, OG-032): `subjectKind` hangisinin gösterileceğini seçer. Öğrenci adı
 * API'den dönmez; o satırlar yalnız geri çekmek içindir, yeni rıza verilmez.
 */
function ConsentSubject({
  title,
  studentId,
  purposes,
  subjectKind,
  description,
  hideWhenEmpty = false,
  session,
}: {
  title: string
  description?: string
  studentId?: string
  purposes: readonly ConsentPurpose[]
  subjectKind?: 'user' | 'student'
  hideWhenEmpty?: boolean
  session: Session
}) {
  const now = useNow(false)
  const list = useConsents(studentId)
  const status = useConsentStatus(studentId, { enabled: purposes.length > 0 })
  const withdraw = useWithdrawConsent()
  const [target, setTarget] = useState<ConsentRow | null>(null)
  const views = (list.data?.data ?? []).filter(
    (view) => subjectKind === undefined || view.subjectKind === subjectKind,
  )
  const rows = consentRows(views, now, status.data?.data)
  const candidates = session.role === 'ogrenci' && studentId ? objectionCandidates(views, now) : []
  const copy = target ? WITHDRAW_COPY[target.kind] : null

  async function confirmWithdraw() {
    if (!target || !copy) return
    const outcome = await withdraw.submit(target.id)
    if (outcome.status === 'busy') return
    if (outcome.status === 'success') notify.success(copy.done)
    setTarget(null)
  }

  if (hideWhenEmpty && rows.length === 0 && target === null) return null

  return (
    <div className="grid gap-4" role="group" aria-label={`${title} rızaları`}>
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {list.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Rızalar yükleniyor…
        </p>
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz rıza kaydı yok.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3 max-[860px]:flex-col max-[860px]:items-stretch"
            >
              <div className="grid gap-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {row.label}
                  <StatusBadge text={row.statusText} tone={row.tone} />
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.kindLabel} verildi: {row.givenLabel} · Metin sürümü {row.version} ·{' '}
                  {row.grantor}
                  {row.expiresLabel ? ` · Geçerlilik sonu: ${row.expiresLabel}` : ''}
                  {row.withdrawnLabel ? ` · Geri çekildi: ${row.withdrawnLabel}` : ''}
                </p>
              </div>
              {row.canWithdraw ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={row.withdrawName}
                  className="max-[860px]:min-h-12"
                  onClick={() => setTarget(row)}
                >
                  Geri çek
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 ? (
        <ObjectionPanel studentId={studentId} purposes={candidates} />
      ) : null}
      {purposes.length > 0 ? (
        <div className="grid gap-3">
          <h4 className="text-sm font-semibold">Rıza ver</h4>
          <ConsentStep studentId={studentId} purposes={purposes} showGranted={false} />
        </div>
      ) : null}
      <Modal
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !withdraw.isPending) setTarget(null)
        }}
        title={copy?.title ?? ''}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={withdraw.isPending}
              onClick={() => setTarget(null)}
            >
              Vazgeç
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={withdraw.isPending}
              aria-busy={withdraw.isPending}
              onClick={() => void confirmWithdraw()}
            >
              {copy?.confirm}
            </Button>
          </>
        }
      >
        <p className="text-sm">{target && copy ? copy.body(target.label) : null}</p>
      </Modal>
    </div>
  )
}

/** 18 yaş altı öğrencinin velisinin fotoğraf/video rızasına itirazı (DOM-YTK-062). */
function ObjectionPanel({
  studentId,
  purposes,
}: {
  studentId: string | undefined
  purposes: readonly ConsentPurpose[]
}) {
  const texts = useConsentTexts(purposes)
  const give = useGiveConsent()
  const [target, setTarget] = useState<ConsentPurpose | null>(null)
  const textId = target ? texts[purposes.indexOf(target)]?.data?.data.text.id : undefined

  async function confirm() {
    if (!target || !textId || !studentId) return
    const outcome = await give.submit({
      purpose: target,
      studentId,
      textId,
      decision: 'objected',
    })
    if (outcome.status === 'busy') return
    if (outcome.status === 'success') notify.success(OBJECTION_COPY.done)
    setTarget(null)
  }

  return (
    <div className="grid gap-2 rounded-xl border bg-surface-soft p-3">
      <h4 className="text-sm font-semibold">İtiraz</h4>
      <p className="text-sm text-muted-foreground">{OBJECTION_COPY.intro}</p>
      <ul className="flex flex-wrap gap-2">
        {purposes.map((purpose, index) => (
          <li key={purpose}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!texts[index]?.data}
              aria-label={`${purposeLabel(purpose)} için itiraz et`}
              className="max-[860px]:min-h-12"
              onClick={() => setTarget(purpose)}
            >
              İtiraz et
            </Button>
          </li>
        ))}
      </ul>
      <Modal
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !give.isPending) setTarget(null)
        }}
        title={OBJECTION_COPY.title}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={give.isPending}
              onClick={() => setTarget(null)}
            >
              Vazgeç
            </Button>
            <Button
              type="button"
              disabled={give.isPending || !textId}
              aria-busy={give.isPending}
              onClick={() => void confirm()}
            >
              İtiraz et
            </Button>
          </>
        }
      >
        <p className="text-sm">{target ? OBJECTION_COPY.body(purposeLabel(target)) : null}</p>
      </Modal>
    </div>
  )
}
