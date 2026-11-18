import { useState } from 'react'
import { useAddProspectNote } from '@kampus/react-shared/use-prospect-commands.ts'
import {
  useAddProspectDocument,
  useProspectDocuments,
  useProspectDocumentUrlFetcher,
  useRecordDocumentConsent,
  useReviewProspectDocument,
  useWithdrawDocumentConsent,
  type ProspectDocuments,
} from '@kampus/react-shared/use-prospect-documents.ts'
import {
  DOCUMENT_REJECTION_NOTICE,
  PROSPECT_DOCUMENT_PURPOSE,
  PROSPECT_DOCUMENT_REJECTION_MAX,
} from '@kampus/school-core/lib/prospect-documents.ts'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { FILE_OPEN_FAILED, FILE_POPUP_BLOCKED } from '../learning/SubmissionFiles.tsx'
import {
  consentLabel,
  documentRowView,
  hasSpecialTypes,
  missingLabel,
  reminderNote,
  typeOptionLabel,
  uploadableTypes,
  type DocumentRowView,
} from './prospect-documents.ts'
import { dateTimeLabel } from './prospect-rows.ts'

/**
 * Aday detayında "Belgeler" bölümü (DOM-KAY-043; ON-263): eksik zorunlu belgeler ve "Hatırlat"
 * (aday kartına görüşme notu; platform ileti göndermez, K-323), özel nitelikli belge rızası
 * (K-322), belge ekleme (dosya önce `POST /files` amaç `document`: PDF, 20 MB), güncel belgeler
 * (aç, kabul, gerekçeli ret) ve önceki yüklemeler. Belge açılışı her seferinde denetim kaydıdır;
 * bağlantı yalnız "Aç" ile istenir.
 */
export function ProspectDocumentsSection({
  prospectId,
  prospectVersion,
  open,
}: {
  prospectId: string
  /** Adayın okunan sürümü: "Hatırlat" notu `If-Match` ile yazılır. */
  prospectVersion: number
  /** Aday açık mı (not yalnız açık adaya eklenir). */
  open: boolean
}) {
  const documents = useProspectDocuments(prospectId)
  return (
    <section aria-labelledby="aday-belgeler" className="panel rounded-card border bg-surface p-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="aday-belgeler" className="text-lg font-semibold">
            Belgeler
          </h2>
          <p className="text-sm text-muted-foreground">
            Kimlik, karne, sağlık raporu gibi kayıt belgeleri. Belgeler PDF olarak yüklenir.
          </p>
        </div>
        {documents.data ? (
          <StatusBadge
            text={
              documents.data.data.gaps.missing.length > 0
                ? `${documents.data.data.gaps.missing.length} eksik belge`
                : 'Eksik belge yok'
            }
            tone={documents.data.data.gaps.missing.length > 0 ? 'amber' : 'green'}
          />
        ) : null}
      </header>
      {documents.error ? (
        <QueryError error={documents.error} onRetry={() => void documents.refetch()} />
      ) : documents.data ? (
        <DocumentsBody
          data={documents.data.data}
          prospectVersion={prospectVersion}
          prospectOpen={open}
        />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Belgeler yükleniyor…
        </p>
      )}
    </section>
  )
}

function DocumentsBody({
  data,
  prospectVersion,
  prospectOpen,
}: {
  data: ProspectDocuments
  prospectVersion: number
  prospectOpen: boolean
}) {
  const rows = data.documents.map((document) =>
    documentRowView(document, data.types, data.accepting),
  )
  const current = rows.filter((row) => row.current)
  const history = rows.filter((row) => !row.current)
  return (
    <div className="grid gap-5">
      <MissingDocuments data={data} prospectVersion={prospectVersion} prospectOpen={prospectOpen} />
      {hasSpecialTypes(data.types) ? <DocumentConsent data={data} /> : null}
      {data.accepting ? (
        <AddDocumentForm data={data} />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Vazgeçen adaya belge eklenmez. Önce adayı yeniden açın.
        </p>
      )}
      <DocumentList prospectId={data.prospectId} rows={current} label="Güncel belgeler" />
      {history.length > 0 ? (
        <details className="grid gap-2">
          <summary className="cursor-pointer text-sm font-medium">
            Önceki yüklemeler ({history.length})
          </summary>
          <DocumentList prospectId={data.prospectId} rows={history} label="Önceki yüklemeler" />
        </details>
      ) : null}
    </div>
  )
}

function MissingDocuments({
  data,
  prospectVersion,
  prospectOpen,
}: {
  data: ProspectDocuments
  prospectVersion: number
  prospectOpen: boolean
}) {
  const note = useAddProspectNote()
  const { missing } = data.gaps
  if (missing.length === 0) return null

  async function remind() {
    const outcome = await note.submit({
      prospectId: data.prospectId,
      version: prospectVersion,
      body: { text: reminderNote(missing) },
    })
    if (outcome.status === 'success') notify.success('Hatırlatma aday kartına not olarak eklendi.')
  }

  return (
    <div className="grid gap-3 rounded-card border bg-warning-soft p-4 text-sm">
      <p className="font-medium">Eksik belgeler: {missingLabel(missing)}</p>
      <p className="text-muted-foreground">
        Platform aileye ileti göndermez. Aileye ulaştıktan sonra “Hatırlat” iletişim geçmişine not
        düşer.
      </p>
      {prospectOpen ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={note.isPending}
            aria-busy={note.isPending || undefined}
            onClick={() => void remind()}
          >
            <Icon name="Bell" size={15} aria-hidden="true" />
            Hatırlat
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function DocumentConsent({ data }: { data: ProspectDocuments }) {
  const record = useRecordDocumentConsent()
  const withdraw = useWithdrawDocumentConsent()
  const [confirming, setConfirming] = useState(false)
  const active = data.consent.active

  async function grant() {
    const outcome = await record.submit({ prospectId: data.prospectId })
    if (outcome.status === 'success') notify.success('Açık rıza kaydedildi.')
  }
  async function revoke() {
    if (!active) return
    const outcome = await withdraw.submit({ prospectId: data.prospectId, version: active.version })
    if (outcome.status === 'success') {
      notify.success('Rıza geri çekildi; özel nitelikli belgeler imhaya ayrıldı.')
      setConfirming(false)
    }
  }

  return (
    <div className="grid gap-2 rounded-card border p-4 text-sm">
      <h3 className="font-semibold">Özel nitelikli belge rızası</h3>
      <p>{consentLabel(data.consent)}</p>
      {active ? (
        <p className="text-xs text-muted-foreground">
          Kaydedildi: {dateTimeLabel(active.grantedAt)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Rızayı geri çek
          </Button>
        ) : data.accepting ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={record.isPending}
            aria-busy={record.isPending || undefined}
            onClick={() => void grant()}
          >
            <Icon name="ClipboardCheck" size={15} aria-hidden="true" />
            Islak imzalı rıza formu alındı
          </Button>
        ) : null}
      </div>
      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title="Rızayı geri çek"
        description="Adayın özel nitelikli belgeleri listeden kalkar ve dosyaları imha edilir. Bu işlem geri alınmaz."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={withdraw.isPending}
              aria-busy={withdraw.isPending || undefined}
              onClick={() => void revoke()}
            >
              Rızayı geri çek
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Geri çekmeden sonra sağlık raporu yeniden rıza alınmadan yüklenemez.
        </p>
      </Modal>
    </div>
  )
}

function AddDocumentForm({ data }: { data: ProspectDocuments }) {
  const add = useAddProspectDocument()
  const types = uploadableTypes(data.types)
  const [typeId, setTypeId] = useState('')
  const [items, setItems] = useState<readonly FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const busy = add.isPending || uploading
  const selected = types.find((type) => type.id === typeId)
  const needsConsent = selected?.specialCategory === true && data.consent.active === null

  async function submit() {
    const file = items[0]
    if (!selected) {
      setError('Belge türünü seçin.')
      return
    }
    if (!file) return
    const outcome = await add.submit(
      { prospectId: data.prospectId, documentTypeId: selected.id, fileId: file.id },
      {
        setError: (_name, issue) => setError(issue.message),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Belge eklendi.')
      setItems([])
      setTypeId('')
      setError(undefined)
    }
  }

  return (
    <form
      noValidate
      aria-label="Belge ekle"
      className="grid gap-4 rounded-card border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && !blocked) void submit()
      }}
    >
      <h3 className="text-sm font-semibold">Belge ekle</h3>
      <FormField
        id="aday-belge-turu"
        label="Belge türü"
        error={error ? { message: error } : undefined}
        {...(needsConsent ? { description: 'Bu belge için önce açık rıza formunu kaydedin.' } : {})}
      >
        {(control) => (
          <NativeSelect
            {...control}
            value={typeId}
            disabled={busy}
            onChange={(event) => {
              setTypeId(event.target.value)
              setError(undefined)
            }}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {types.map((type) => (
              <NativeSelectOption key={type.id} value={type.id}>
                {typeOptionLabel(type)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FileUploadField
        id="aday-belge-dosyasi"
        label="Belge dosyası"
        purpose={PROSPECT_DOCUMENT_PURPOSE}
        description="PDF, en çok 20 MB. Aynı türe yeni belge eklemek öncekinin yerine geçer."
        listLabel="Eklenecek belge"
        items={items}
        disabled={add.isPending}
        onUploaded={(item) => setItems([item])}
        onRemoved={(id) => setItems((current) => current.filter((file) => file.id !== id))}
        onBusyChange={setUploading}
        onBlockedChange={setBlocked}
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={busy || blocked || items.length === 0 || needsConsent}
          aria-busy={add.isPending || undefined}
        >
          <Icon name="Upload" size={16} aria-hidden="true" />
          Belgeyi ekle
        </Button>
      </div>
    </form>
  )
}

function DocumentList({
  prospectId,
  rows,
  label,
}: {
  prospectId: string
  rows: readonly DocumentRowView[]
  label: string
}) {
  const fetchUrl = useProspectDocumentUrlFetcher()
  const [opening, setOpening] = useState('')
  const [rejecting, setRejecting] = useState<DocumentRowView | null>(null)
  const review = useReviewProspectDocument()

  async function openDocument(row: DocumentRowView) {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      // Bağlantı üretmek denetim kaydıdır; pencere açılamıyorsa üretilmez.
      notify.error(FILE_POPUP_BLOCKED)
      return
    }
    setOpening(row.id)
    try {
      const { url } = await fetchUrl(prospectId, row.id)
      tab.opener = null
      tab.location.href = url
    } catch (error) {
      tab.close()
      notify.error(FILE_OPEN_FAILED, error)
    } finally {
      setOpening('')
    }
  }
  async function accept(row: DocumentRowView) {
    const outcome = await review.submit({
      prospectId,
      documentId: row.id,
      version: row.version,
      body: { decision: 'accept' },
    })
    if (outcome.status === 'success') notify.success('Belge kabul edildi.')
  }

  if (rows.length === 0)
    return label === 'Güncel belgeler' ? (
      <p className="text-sm text-muted-foreground">Henüz belge eklenmedi.</p>
    ) : null
  return (
    <>
      <ul aria-label={label} className="grid gap-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border px-3.5 py-3 text-sm"
          >
            <div className="grid min-w-0 gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <Icon name="FileText" size={16} aria-hidden="true" />
                <span className="font-medium">{row.typeLabel}</span>
                <StatusBadge text={row.statusLabel} tone={row.tone} />
              </span>
              <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {row.name} · {row.detail}
              </span>
              {row.rejectionReason ? (
                <span className="text-xs">Ret gerekçesi: {row.rejectionReason}</span>
              ) : null}
              {row.purgeAt ? (
                <span className="text-xs text-muted-foreground">
                  İmha tarihi: {dateTimeLabel(row.purgeAt)}
                </span>
              ) : null}
            </div>
            <span className="flex flex-wrap gap-2">
              {row.canOpen ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`${row.typeLabel} belgesini aç`}
                  disabled={opening === row.id}
                  aria-busy={opening === row.id || undefined}
                  onClick={() => void openDocument(row)}
                >
                  <Icon name="ExternalLink" size={15} aria-hidden="true" />
                  Aç
                </Button>
              ) : null}
              {row.reviewable ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    aria-label={`${row.typeLabel} belgesini kabul et`}
                    disabled={review.isPending}
                    onClick={() => void accept(row)}
                  >
                    Kabul et
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${row.typeLabel} belgesini reddet`}
                    disabled={review.isPending}
                    onClick={() => setRejecting(row)}
                  >
                    Reddet
                  </Button>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {rejecting ? (
        <RejectModal prospectId={prospectId} row={rejecting} onClose={() => setRejecting(null)} />
      ) : null}
    </>
  )
}

function RejectModal({
  prospectId,
  row,
  onClose,
}: {
  prospectId: string
  row: DocumentRowView
  onClose: () => void
}) {
  const review = useReviewProspectDocument()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | undefined>()

  async function submit() {
    const trimmed = reason.trim()
    if (trimmed.length < 2) {
      setError('Ret gerekçesini yazın.')
      return
    }
    const outcome = await review.submit(
      {
        prospectId,
        documentId: row.id,
        version: row.version,
        body: { decision: 'reject', reason: trimmed },
      },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success('Belge reddedildi.')
      onClose()
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={`${row.typeLabel} belgesini reddet`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="belge-ret-formu"
            disabled={review.isPending}
            aria-busy={review.isPending || undefined}
          >
            Reddet
          </Button>
        </>
      }
    >
      <form
        id="belge-ret-formu"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <FormField
          id="belge-ret-gerekcesi"
          label="Ret gerekçesi"
          description={DOCUMENT_REJECTION_NOTICE}
          error={error ? { message: error } : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              value={reason}
              rows={3}
              maxLength={PROSPECT_DOCUMENT_REJECTION_MAX}
              onChange={(event) => {
                setReason(event.target.value)
                setError(undefined)
              }}
            />
          )}
        </FormField>
      </form>
    </Modal>
  )
}
