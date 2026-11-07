import { useRef, useState } from 'react'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  useArchiveRubric,
  usePublishRubric,
  useRubricDetail,
  type RubricDetail,
  type RubricVersion,
} from '@kampus/react-shared/use-rubrics.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import {
  alignmentLabel,
  aspectLabel,
  bandTitle,
  editTarget,
  kindLabel,
  rubricActions,
  sharedAlignment,
  skillLabel,
  statusLabel,
  STATUS_TONES,
  totalAssignments,
  usageLabel,
  versionHistory,
  versionTarget,
  weightShares,
} from './rubric-library-model.ts'

type Props = {
  /** `''` kapalı. */
  rubricId: string
  onClose: () => void
  /** Form penceresini açar (`?rubrik-form=`). */
  onForm: (target: string) => void
}

/**
 * Rubrik ayrıntısı (sağ panel; IST-048, DOM-BEC-020, DOM-BEC-022): künye, kullanım, sürüm
 * geçmişi ve seçili sürümün kriter × bant tablosu (ağırlık, pay, eşleme). Sahip ve yönetici
 * taslağı düzenler, yayımlar, yeni sürüm açar ve yayındaki sürümü arşivler; yayım ve arşiv
 * okunan sürümle (`If-Match`) gider, çakışmada Türkçe uyarı çıkar ve ayrıntı tazelenir.
 */
export function RubricDetailPanel({ rubricId, onClose, onForm }: Props) {
  const detail = useRubricDetail(rubricId)
  const data = detail.data?.data
  const head = data ? rubricActions(data).head : null
  return (
    <SidePanel
      open={rubricId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={head ? head.title : 'Rubrik ayrıntısı'}
    >
      {detail.error ? (
        <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
      ) : data ? (
        <PanelBody key={data.rubric.id} detail={data} onForm={onForm} />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Rubrik yükleniyor…
        </p>
      )}
    </SidePanel>
  )
}

type Confirm = 'publish' | 'archive' | null

function PanelBody({ detail, onForm }: { detail: RubricDetail; onForm: (target: string) => void }) {
  const publish = usePublishRubric()
  const archive = useArchiveRubric()
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [chosenId, setChosenId] = useState('')
  // Onay kapanınca açan düğme kaybolmuş olabilir (yayınla, arşivle); odak panelde kalır ki Esc
  // paneli kapatsın ve klavye konumu yitmesin.
  const body = useRef<HTMLDivElement>(null)
  const actions = rubricActions(detail)
  const history = versionHistory(detail.versions)
  // Seçim yoksa (ya da seçilen sürüm artık yoksa) baş sürüm gösterilir.
  const shown = history.find((version) => version.id === chosenId) ?? actions.head
  const busy = publish.isPending || archive.isPending
  if (!actions.head || !shown) return null
  const head = actions.head
  const assignments = totalAssignments(detail.versions)

  async function run(kind: 'publish' | 'archive') {
    const target = kind === 'publish' ? actions.draft : actions.published
    if (!target) return
    const command = kind === 'publish' ? publish : archive
    const outcome = await command.submit({
      rubricId: detail.rubric.id,
      versionId: target.id,
      version: target.rowVersion,
    })
    setConfirm(null)
    if (outcome.status !== 'success') return
    setChosenId('')
    notify.success(
      kind === 'publish'
        ? `v${target.versionNumber} yayımlandı; yeni görevlerde bu sürüm kullanılır.`
        : `v${target.versionNumber} arşivlendi; sabitlendiği görevlerde puanlanmaya devam eder.`,
    )
  }

  return (
    <div ref={body} tabIndex={-1} className="grid gap-6 outline-none">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Durum</dt>
          <dd>
            <StatusBadge text={statusLabel(head.status)} tone={STATUS_TONES[head.status]} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Son sürüm</dt>
          <dd>v{head.versionNumber}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tür</dt>
          <dd>{kindLabel(head.kind)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Beceri</dt>
          <dd>{skillLabel(head.skill)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Yayındaki sürüm</dt>
          <dd>{actions.published ? `v${actions.published.versionNumber}` : 'Yok'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Kullanım</dt>
          <dd>{assignments > 0 ? `${assignments} görev` : 'Henüz görevde yok'}</dd>
        </div>
      </dl>

      {detail.rubric.canManage ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Rubrik işlemleri">
          {actions.canPublish ? (
            <Button disabled={busy} onClick={() => setConfirm('publish')}>
              <Icon name="Check" size={16} aria-hidden="true" />
              Yayınla
            </Button>
          ) : null}
          {actions.canEditDraft ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => onForm(editTarget(detail.rubric.id))}
            >
              <Icon name="Pencil" size={16} aria-hidden="true" />
              Taslağı düzenle
            </Button>
          ) : null}
          {actions.canOpenVersion ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => onForm(versionTarget(detail.rubric.id))}
            >
              <Icon name="Copy" size={16} aria-hidden="true" />
              Yeni sürüm aç
            </Button>
          ) : null}
          {actions.canArchive ? (
            <Button variant="outline" disabled={busy} onClick={() => setConfirm('archive')}>
              <Icon name="Archive" size={16} aria-hidden="true" />
              Arşivle
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Bu rubriği yalnız sahibi ve yönetici değiştirebilir; yayındaki sürümü görevlerinizde
          kullanabilirsiniz.
        </p>
      )}

      <section aria-labelledby="rubrik-surumleri" className="grid gap-3">
        <h3 id="rubrik-surumleri" className="text-base font-semibold">
          Sürüm geçmişi
        </h3>
        <ol className="grid gap-2">
          {history.map((version) => (
            <li
              key={version.id}
              className="grid gap-1 rounded-card border bg-surface px-4 py-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">v{version.versionNumber}</span>
                <StatusBadge
                  text={statusLabel(version.status)}
                  tone={STATUS_TONES[version.status]}
                />
              </div>
              <p className="text-muted-foreground">{versionDates(version)}</p>
              <p className="text-muted-foreground">{usageLabel(version.usage)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="rubrik-kriterleri" className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 id="rubrik-kriterleri" className="text-base font-semibold">
            Kriterler ve bantlar
          </h3>
          {history.length > 1 ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Görüntülenen sürüm</span>
              <NativeSelect
                value={shown.id}
                onChange={(event) => setChosenId(event.target.value)}
                aria-label="Görüntülenen sürüm"
              >
                {history.map((version) => (
                  <NativeSelectOption key={version.id} value={version.id}>
                    v{version.versionNumber} · {statusLabel(version.status)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : null}
        </div>
        <CriteriaTables version={shown} />
      </section>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => (open || busy ? undefined : setConfirm(null))}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            body.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'archive' ? 'Rubriği arşivle' : 'Rubriği yayınla'}
            </AlertDialogTitle>
            <AlertDialogDescription>{confirmText(confirm, actions)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={(event) => {
                // Pencere sonuç gelene kadar açık kalır; kapanışı `run` yönetir.
                event.preventDefault()
                if (confirm) void run(confirm)
              }}
            >
              {confirm === 'archive' ? 'Arşivle' : 'Yayınla'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function confirmText(confirm: Confirm, actions: ReturnType<typeof rubricActions>): string {
  if (confirm === 'archive' && actions.published)
    return `v${actions.published.versionNumber} arşivlenecek ve yeni görevlerde seçilemeyecek. Sabitlendiği görevlerde puanlama sürer; arşiv geri alınmaz, gerekirse yeni sürüm açılır.`
  if (confirm === 'publish' && actions.draft)
    return actions.published
      ? `v${actions.draft.versionNumber} yayımlanacak; yayındaki v${actions.published.versionNumber} aynı anda arşivlenir. Yayımlanan sürüm değiştirilemez.`
      : `v${actions.draft.versionNumber} yayımlanacak ve görevlerde seçilebilecek. Yayımlanan sürüm değiştirilemez.`
  return ''
}

function versionDates(version: RubricVersion): string {
  const parts = [`Oluşturuldu ${dateLabel(version.createdAt, { year: 'numeric' })}`]
  if (version.publishedAt)
    parts.push(`yayımlandı ${dateLabel(version.publishedAt, { year: 'numeric' })}`)
  if (version.archivedAt)
    parts.push(`arşivlendi ${dateLabel(version.archivedAt, { year: 'numeric' })}`)
  return parts.join(' · ')
}

/** Kriter özeti (ağırlık, pay, eşleme) ve kriter başına bant tablosu. */
function CriteriaTables({ version }: { version: RubricVersion }) {
  const shares = weightShares(version.criteria.map((criterion) => criterion.weight))
  return (
    <div className="grid gap-5">
      <div className="overflow-x-auto rounded-card border bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">v{version.versionNumber} kriterleri ve ağırlıkları</caption>
          <thead className="bg-surface-soft text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Kriter
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Ağırlık
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Pay
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Eşleme
              </th>
            </tr>
          </thead>
          <tbody>
            {version.criteria.map((criterion, index) => {
              const shared = sharedAlignment(criterion)
              return (
                <tr key={criterion.id} className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {aspectLabel(criterion.aspect)}
                  </th>
                  <td className="px-3 py-2">{criterion.weight}</td>
                  <td className="px-3 py-2">%{shares[index] ?? 0}</td>
                  <td className="px-3 py-2 [overflow-wrap:anywhere]">
                    {shared ? alignmentLabel(shared) : 'Banda göre değişir'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {version.criteria.map((criterion) => {
        const shared = sharedAlignment(criterion)
        const bands = [...criterion.bands].sort((a, b) => a.band - b.band)
        return (
          <div key={criterion.id} className="overflow-x-auto rounded-card border bg-surface">
            <table className="w-full text-sm">
              <caption className="px-3 pt-3 text-left font-medium">
                {aspectLabel(criterion.aspect)} bantları
              </caption>
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="w-40 px-3 py-2 font-medium">
                    Bant
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Tanım
                  </th>
                  {shared ? null : (
                    <th scope="col" className="px-3 py-2 font-medium">
                      Eşleme
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {bands.map((band) => (
                  <tr key={band.band} className="border-t align-top">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {bandTitle(band.band)}
                    </th>
                    <td className="px-3 py-2 [overflow-wrap:anywhere]">{band.description}</td>
                    {shared ? null : (
                      <td className="px-3 py-2 [overflow-wrap:anywhere]">
                        {alignmentLabel(band.alignment)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
