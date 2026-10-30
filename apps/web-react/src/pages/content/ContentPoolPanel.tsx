import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  availableActions,
  canEditDraft,
  canOpenNewVersion,
  isStaffDetail,
  type ActionKind,
  type ActionState,
  type StaffResourceDetail,
} from '@kampus/react-shared/resource-model.ts'
import {
  useOpenNewVersion,
  useResourceDetail,
  useResourceTransition,
} from '@kampus/react-shared/use-resources.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useNow } from '@/hooks/use-now.ts'
import { notify } from '@/lib/notify.ts'
import { ConflictNotice, isVersionConflict } from '../management/FormParts.tsx'
import {
  draftFromHead,
  isEnglishContent,
  licenseLabel,
  previewFromHead,
  rejectSchema,
  shareScopeLabel,
  statusLabel,
  STATUS_TONES,
  tagSummary,
  typeLabel,
  type ContentPreview,
  type RejectInput,
} from './content-pool-model.ts'

const SUCCESS: Record<ActionKind, string> = {
  submit: 'İçerik onaya gönderildi.',
  publish: 'İçerik yayımlandı.',
  withdraw: 'İçerik onaydan geri çekildi.',
  approve: 'İçerik onaylandı ve yayımlandı.',
  reject: 'İçerik reddedildi; gerekçe yazara görünür.',
  reopen: 'İçerik taslağa döndürüldü.',
  archive: 'İçerik arşivlendi.',
}
const PRIMARY: readonly ActionKind[] = ['submit', 'approve']
const ICONS: Record<ActionKind, string> = {
  submit: 'Send',
  publish: 'Check',
  withdraw: 'Undo2',
  approve: 'Check',
  reject: 'X',
  reopen: 'RotateCcw',
  archive: 'Archive',
}

type PanelProps = {
  /** `''` kapalı. */
  resourceId: string
  onClose: () => void
  /** Taslak düzenleme penceresini açar. */
  onEdit: (resourceId: string) => void
  /** Ders kimliği → ad (okul kurumunda etiket özeti için). */
  subjectNames: ReadonlyMap<string, string>
}

/**
 * İçerik ayrıntısı (sağ panel): künye, etiketler, lisans, önizleme, sürüm geçmişi, yayım
 * sorunları ve durum geçişleri. Hangi eylemin görüneceğine core kuralı karar verir
 * (`availableActions`); sunucu aynı kuralı yeniden uygular. Başkası içeriği değiştirmişse (409)
 * uyarı bandı ve "Güncel kaydı yükle" çıkar.
 */
export function ContentPoolPanel({ resourceId, onClose, onEdit, subjectNames }: PanelProps) {
  const detail = useResourceDetail(resourceId)
  const data = detail.data?.data
  const staff = data && isStaffDetail(data) ? data : null
  return (
    <SidePanel
      open={resourceId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={staff ? staff.head.title : 'İçerik ayrıntısı'}
    >
      {detail.error ? (
        <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
      ) : staff ? (
        <PanelBody
          // Sürüm değişince (yenileme, yeni sürüm) iç durum sıfırlanır.
          key={`${staff.head.id}:${staff.head.rowVersion}`}
          detail={staff}
          reload={async () => void (await detail.refetch())}
          onEdit={onEdit}
          onClose={onClose}
          subjectNames={subjectNames}
        />
      ) : data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Bu içeriğin personel ayrıntısı görüntülenemiyor.
        </p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          İçerik yükleniyor…
        </p>
      )}
    </SidePanel>
  )
}

function PanelBody({
  detail,
  reload,
  onEdit,
  onClose,
  subjectNames,
}: {
  detail: StaffResourceDetail
  reload: () => Promise<void>
  onEdit: (resourceId: string) => void
  onClose: () => void
  subjectNames: ReadonlyMap<string, string>
}) {
  const { session } = useAuth()
  // Render'da `Date.now()` yok; süresi dolan lisans eksiği yenilemede yeniden hesaplanır.
  const now = useNow(false)
  const transition = useResourceTransition()
  const openVersion = useOpenNewVersion()
  const [conflict, setConflict] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const { head, resource } = detail
  if (!session) return null
  const actor = { role: session.role, userId: session.user.id }
  const institutionType = session.institution.type
  const actions = availableActions({
    detail,
    actor,
    institutionType,
    now: new Date(now),
  })
  const editable = canEditDraft(head, actor.userId) && draftFromHead(head) !== null
  const newVersion = canOpenNewVersion({ detail, actor, institutionType })
  const busy = transition.isPending || openVersion.isPending

  async function run(action: ActionKind, reason?: string) {
    const outcome = await transition.submit(
      {
        action,
        resourceId: resource.id,
        versionId: head.id,
        version: head.rowVersion,
        ...(reason === undefined ? {} : { reason }),
      },
      { silent: isVersionConflict },
    )
    if (outcome.status === 'success') notify.success(SUCCESS[action])
    else if (outcome.status === 'failed' && isVersionConflict(outcome.error)) setConflict(true)
    return outcome
  }

  async function reloadRecord() {
    setReloading(true)
    try {
      await reload()
      setConflict(false)
    } finally {
      setReloading(false)
    }
  }

  async function startVersion() {
    const outcome = await openVersion.submit({ resourceId: resource.id })
    if (outcome.status === 'success') notify.success('Yeni taslak açıldı.')
  }

  const english = isEnglishContent(head.tags)
  const outcomes = head.tags.outcomes
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge text={statusLabel(head.status)} tone={STATUS_TONES[head.status]} />
        <StatusBadge text={typeLabel(resource.contentType)} />
        <span className="text-sm text-muted-foreground">
          Sürüm {head.versionNumber} · {dateLabel(head.updatedAt, { year: 'numeric' })}
        </span>
      </div>

      {conflict ? (
        <ConflictNotice onReload={() => void reloadRecord()} reloading={reloading} />
      ) : null}

      {head.status === 'rejected' && head.rejectionReason ? (
        <section
          role="note"
          aria-label="Ret gerekçesi"
          className="rounded-card border bg-danger-soft p-4"
        >
          <h3 className="text-sm font-semibold">Ret gerekçesi</h3>
          <p className="mt-1 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
            {head.rejectionReason}
          </p>
        </section>
      ) : null}

      {detail.publicationIssues.length > 0 ? (
        <section aria-label="Yayım sorunları" className="rounded-card border bg-warning-soft p-4">
          <h3 className="text-sm font-semibold">Yayımlamadan önce tamamlanmalı</h3>
          <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm">
            {detail.publicationIssues.map((issue) => (
              <li key={`${issue.code}:${issue.path.join('.')}`}>{issue.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <Preview preview={previewFromHead(head)} english={english} />

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Fact label="Etiketler" value={tagSummary(head.tags, subjectNames)} />
        <Fact label="Lisans" value={licenseLabel(head.licenseKind)} />
        <Fact label="Paylaşım" value={shareScopeLabel(resource.shareScope)} />
        <Fact
          label="Kazanım"
          value={outcomes.length > 0 ? outcomes.map((o) => o.outcomeId).join(', ') : '—'}
        />
      </dl>

      {head.attributions.length > 0 ? (
        <section aria-label="Kaynak gösterimi">
          <h3 className="mb-1.5 text-sm font-semibold">Kaynak gösterimi</h3>
          <ul className="grid gap-1 text-sm">
            {head.attributions.map((item) => (
              <li key={`${item.work}:${item.author}:${item.source}`}>
                <span lang="en" className="font-medium">
                  {item.work}
                </span>{' '}
                — {item.author}, {item.source}
                {item.year ? ` (${item.year})` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Sürüm geçmişi">
        <h3 className="mb-1.5 text-sm font-semibold">Sürüm geçmişi</h3>
        <ol className="grid gap-1 text-sm">
          {[...detail.versions].reverse().map((version) => (
            <li
              key={version.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5"
            >
              <span>
                Sürüm {version.versionNumber}
                {version.id === resource.currentVersionId ? ' · güncel yayın' : ''}
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                {dateLabel(version.updatedAt, { year: 'numeric' })}
                <StatusBadge
                  text={statusLabel(version.status)}
                  tone={STATUS_TONES[version.status]}
                />
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div
        className="flex flex-wrap gap-2 border-t pt-4"
        role="group"
        aria-label="İçerik işlemleri"
      >
        {actions.map((state) => (
          <ActionButton
            key={state.action}
            state={state}
            busy={busy}
            onRun={() =>
              state.action === 'reject'
                ? setRejecting(true)
                : state.action === 'archive'
                  ? setArchiving(true)
                  : void run(state.action)
            }
          />
        ))}
        {editable ? (
          <Button variant="outline" onClick={() => onEdit(resource.id)} disabled={busy}>
            <Icon name="Pencil" size={16} aria-hidden="true" />
            Düzenle
          </Button>
        ) : null}
        {newVersion ? (
          <Button variant="outline" onClick={() => void startVersion()} disabled={busy}>
            <Icon name="Copy" size={16} aria-hidden="true" />
            Yeni sürüm aç
          </Button>
        ) : null}
      </div>
      {actions.length === 0 && !editable && !newVersion ? (
        <p className="text-sm text-muted-foreground">Bu içerik için yapılabilecek işlem yok.</p>
      ) : null}

      <RejectModal
        open={rejecting}
        onOpenChange={setRejecting}
        onReject={async (reason, setError) => {
          const outcome = await transition.submit(
            {
              action: 'reject',
              resourceId: resource.id,
              versionId: head.id,
              version: head.rowVersion,
              reason,
            },
            { setError, silent: isVersionConflict },
          )
          if (outcome.status === 'success') {
            notify.success(SUCCESS.reject)
            // Reddedilen taslak yalnız yazarına görünür (DOM-KYN-052): yönetici için panel kapanır.
            if (head.authorUserId !== actor.userId && resource.ownerUserId !== actor.userId)
              onClose()
          } else if (outcome.status === 'failed' && isVersionConflict(outcome.error)) {
            setConflict(true)
            setRejecting(false)
          }
          return outcome.status === 'success'
        }}
      />
      <Modal
        open={archiving}
        onOpenChange={setArchiving}
        title="İçeriği arşivle"
        description="Arşivlenen içerik listede durur ama yeni atamada kullanılamaz."
        footer={
          <>
            <Button variant="outline" onClick={() => setArchiving(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() =>
                void run('archive').then((outcome) => {
                  if (outcome.status !== 'busy') setArchiving(false)
                })
              }
            >
              Arşivle
            </Button>
          </>
        }
      >
        <p className="text-sm">
          <strong className="font-medium [overflow-wrap:anywhere]">{head.title}</strong> arşivlensin
          mi?
        </p>
      </Modal>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border bg-surface-soft px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

function ActionButton({
  state,
  busy,
  onRun,
}: {
  state: ActionState
  busy: boolean
  onRun: () => void
}) {
  const reasonId = `icerik-eylem-${state.action}-neden`
  const blocked = state.blockedReason !== null
  return (
    <div className="grid max-w-full gap-1">
      <Button
        variant={PRIMARY.includes(state.action) ? 'default' : 'outline'}
        onClick={onRun}
        disabled={busy || blocked}
        aria-describedby={blocked ? reasonId : undefined}
      >
        <Icon name={ICONS[state.action]} size={16} aria-hidden="true" />
        {state.label}
      </Button>
      {blocked ? (
        <p id={reasonId} className="max-w-[40ch] text-xs text-muted-foreground">
          {state.blockedReason}
        </p>
      ) : null}
    </div>
  )
}

function Preview({ preview, english }: { preview: ContentPreview; english: boolean }) {
  const lang = english ? 'en' : undefined
  if (preview.kind === 'removed')
    return <p className="text-sm text-muted-foreground">Bu sürümün içeriği kaldırıldı.</p>
  if (preview.kind === 'other')
    return <p className="text-sm text-muted-foreground">Bu türün önizlemesi yok.</p>
  if (preview.kind === 'reading')
    return (
      <section aria-label="İçerik önizlemesi" className="rounded-card border bg-surface p-4">
        <p
          lang={lang}
          className="text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap"
        >
          {preview.body}
        </p>
      </section>
    )
  return (
    <section
      aria-label="İçerik önizlemesi"
      className="grid gap-3 rounded-card border bg-surface p-4"
    >
      <p lang={lang} className="text-sm font-medium [overflow-wrap:anywhere] whitespace-pre-wrap">
        {preview.stem}
      </p>
      <ul className="grid gap-1.5 text-sm">
        {preview.options.map((option) => (
          <li
            key={option.id}
            lang={lang}
            className="flex items-start gap-2 rounded-xl border px-3 py-1.5 [overflow-wrap:anywhere]"
          >
            <span className="font-medium uppercase">{option.id}.</span>
            <span className="flex-1">{option.text}</span>
            {option.correct ? <StatusBadge text="Doğru cevap" tone="green" /> : null}
          </li>
        ))}
      </ul>
      {preview.explanation ? (
        <p lang={lang} className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          <strong className="font-medium">Çözüm: </strong>
          {preview.explanation}
        </p>
      ) : null}
    </section>
  )
}

function RejectModal({
  open,
  onOpenChange,
  onReject,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReject: (
    reason: string,
    setError: (name: 'reason', error: { type: string; message: string }) => void,
  ) => Promise<boolean>
}) {
  const form = useForm<RejectInput>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: '' },
  })
  const busy = form.formState.isSubmitting
  const submit = form.handleSubmit(async ({ reason }) => {
    if (await onReject(reason, form.setError)) {
      form.reset()
      onOpenChange(false)
    }
  })
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset()
        onOpenChange(next)
      }}
      title="İçeriği reddet"
      description="Gerekçe içeriği hazırlayan öğretmene görünür."
    >
      <form
        noValidate
        aria-label="İçeriği reddet"
        onSubmit={(event) => {
          event.preventDefault()
          void submit(event)
        }}
        className="grid gap-4"
      >
        <FormField
          id="icerik-ret-gerekce"
          label="Ret gerekçesi"
          error={form.formState.errors.reason}
        >
          {(control) => (
            <Textarea
              {...control}
              {...form.register('reason')}
              rows={4}
              maxLength={1000}
              disabled={busy}
            />
          )}
        </FormField>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            <Icon name="X" size={16} aria-hidden="true" />
            Reddet
          </Button>
        </div>
      </form>
    </Modal>
  )
}
