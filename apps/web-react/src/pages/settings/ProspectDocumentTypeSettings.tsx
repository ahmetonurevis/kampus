import { useState } from 'react'
import {
  useArchiveDocumentType,
  useCreateDocumentType,
  useDocumentTypes,
  useUpdateDocumentType,
  type DocumentTypeRow,
} from '@kampus/react-shared/use-prospect-documents.ts'
import {
  PROSPECT_DOCUMENT_KIND_LABELS,
  PROSPECT_DOCUMENT_KINDS,
  PROSPECT_DOCUMENT_LABEL_MAX,
  PROSPECT_DOCUMENT_STAGE_LABELS,
  PROSPECT_DOCUMENT_STAGES,
  type ProspectDocumentKind,
  type ProspectDocumentStage,
} from '@kampus/school-core/lib/prospect-documents.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { typeSummary } from '../crm/prospect-documents.ts'

/**
 * Ayarlar → Aday belgeleri (yönetici; DOM-KAY-043, ON-263, K-320): adaydan istenen belge türleri.
 * Her tür için ad, zorunluluk, aşama (ön başvuru ya da kesin kayıt) ve özel nitelikli işareti
 * düzeltilir; sağlık raporunun işareti kalkmaz. Tür silinmez, kaldırılınca (arşiv) var olan
 * belgeler kalır. Kurum ilk açılışta varsayılan listeyle başlar.
 */
export function ProspectDocumentTypeSettings() {
  const types = useDocumentTypes()
  const [editing, setEditing] = useState<DocumentTypeRow | 'new' | null>(null)
  const [archiving, setArchiving] = useState<DocumentTypeRow | null>(null)
  const rows = types.data?.data ?? []
  return (
    <section
      aria-labelledby="aday-belge-turleri"
      aria-busy={types.isPending || undefined}
      className="panel grid gap-4 rounded-card border bg-surface p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="aday-belge-turleri" className="text-lg font-semibold">
            Aday belgeleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Adaydan istenen belgeler. Zorunlu belge, aşaması gelince eksik belge listesine girer: ön
            başvuru belgesi aday açıkken, kesin kayıt belgesi teklif aşamasında istenir.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Belge türü ekle
        </Button>
      </header>
      {types.error ? (
        <QueryError error={types.error} onRetry={() => void types.refetch()} />
      ) : types.isPending ? (
        <SummaryLoading />
      ) : (
        <ul aria-label="Belge türleri" className="grid gap-2">
          {rows.map((type) => (
            <li
              key={type.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-sm"
            >
              <div className="grid gap-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {type.label}
                  {type.required ? <StatusBadge text="Zorunlu" tone="purple" /> : null}
                  {type.specialCategory ? <StatusBadge text="Özel nitelikli" tone="red" /> : null}
                </span>
                <span className="text-xs text-muted-foreground">{typeSummary(type)}</span>
              </div>
              <span className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${type.label} türünü düzenle`}
                  onClick={() => setEditing(type)}
                >
                  Düzenle
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`${type.label} türünü kaldır`}
                  onClick={() => setArchiving(type)}
                >
                  Kaldır
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing !== null ? (
        <TypeFormModal
          {...(editing === 'new' ? {} : { type: editing })}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {archiving ? <ArchiveModal type={archiving} onClose={() => setArchiving(null)} /> : null}
    </section>
  )
}

const FORM_ID = 'aday-belge-turu-formu'

function TypeFormModal({ type, onClose }: { type?: DocumentTypeRow; onClose: () => void }) {
  const create = useCreateDocumentType()
  const update = useUpdateDocumentType()
  const [kind, setKind] = useState<ProspectDocumentKind>(type?.kind ?? 'other')
  const [label, setLabel] = useState(type?.label ?? '')
  const [required, setRequired] = useState(type?.required ?? false)
  const [stage, setStage] = useState<ProspectDocumentStage>(type?.stage ?? 'application')
  const [special, setSpecial] = useState(type?.specialCategory ?? false)
  const [error, setError] = useState<string | undefined>()
  const health = kind === 'health_report'
  const busy = create.isPending || update.isPending

  async function submit() {
    const trimmed = label.trim()
    if (trimmed.length < 2) {
      setError('En az 2 karakter girin.')
      return
    }
    const fieldError = {
      setError: (_name: string, issue: { message: string }) => setError(issue.message),
    }
    const specialCategory = health || special
    const outcome = type
      ? await update.submit(
          {
            typeId: type.id,
            version: type.version,
            body: { label: trimmed, required, stage, specialCategory },
          },
          fieldError,
        )
      : await create.submit({ kind, label: trimmed, required, stage, specialCategory }, fieldError)
    if (outcome.status === 'success') {
      notify.success(type ? 'Belge türü güncellendi.' : 'Belge türü eklendi.')
      onClose()
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={type ? 'Belge türünü düzenle' : 'Belge türü ekle'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={FORM_ID} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <FormField id="belge-turu-cesit" label="Tür">
          {(control) => (
            <NativeSelect
              {...control}
              value={kind}
              disabled={type !== undefined}
              onChange={(event) => setKind(event.target.value as ProspectDocumentKind)}
            >
              {PROSPECT_DOCUMENT_KINDS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {PROSPECT_DOCUMENT_KIND_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="belge-turu-adi"
          label="Belge adı"
          error={error ? { message: error } : undefined}
        >
          {(control) => (
            <Input
              {...control}
              value={label}
              maxLength={PROSPECT_DOCUMENT_LABEL_MAX}
              onChange={(event) => {
                setLabel(event.target.value)
                setError(undefined)
              }}
            />
          )}
        </FormField>
        <FormField id="belge-turu-asama" label="İstendiği aşama">
          {(control) => (
            <NativeSelect
              {...control}
              value={stage}
              onChange={(event) => setStage(event.target.value as ProspectDocumentStage)}
            >
              {PROSPECT_DOCUMENT_STAGES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {PROSPECT_DOCUMENT_STAGE_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <div className="flex items-center gap-2">
          <Checkbox
            id="belge-turu-zorunlu"
            checked={required}
            onCheckedChange={(value) => setRequired(value === true)}
          />
          <Label htmlFor="belge-turu-zorunlu">Zorunlu belge</Label>
        </div>
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id="belge-turu-ozel"
              checked={health || special}
              disabled={health}
              onCheckedChange={(value) => setSpecial(value === true)}
            />
            <Label htmlFor="belge-turu-ozel">Özel nitelikli kişisel veri</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Özel nitelikli belge yalnız açık rıza kaydıyla yüklenir ve yalnız yönetici açar. Sağlık
            raporunda bu işaret kaldırılamaz.
          </p>
        </div>
      </form>
    </Modal>
  )
}

function ArchiveModal({ type, onClose }: { type: DocumentTypeRow; onClose: () => void }) {
  const archive = useArchiveDocumentType()
  async function confirm() {
    const outcome = await archive.submit({ typeId: type.id, version: type.version })
    if (outcome.status === 'success') {
      notify.success('Belge türü kaldırıldı.')
      onClose()
    }
  }
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Belge türünü kaldır"
      description={`${type.label} yeni adaylardan istenmez ve eksik belge listesine girmez. Yüklenmiş belgeler adaylarda kalır.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={archive.isPending}
            aria-busy={archive.isPending || undefined}
            onClick={() => void confirm()}
          >
            Kaldır
          </Button>
        </>
      }
    >
      <p className="text-sm">
        Kaldırılan tür yeniden açılmaz; gerekirse aynı adla yeni tür eklenir.
      </p>
    </Modal>
  )
}
