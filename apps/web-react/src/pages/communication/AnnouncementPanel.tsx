import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import {
  useMarkAnnouncementRead,
  useReviseAnnouncement,
  useWithdrawAnnouncement,
} from '@kampus/react-shared/use-communication.ts'
import {
  ANNOUNCEMENT_CATEGORIES,
  publishAnnouncementSchema,
  withdrawAnnouncementSchema,
} from '@kampus/school-core/lib/communication.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import {
  canManageAnnouncement,
  hasText,
  reviseChanges,
  STATUS_UNREAD,
  type AnnouncementRow,
  type Viewer,
} from '@kampus/react-shared/announcement-model.ts'

const reviseSchema = publishAnnouncementSchema.pick({ title: true, text: true, category: true })
type ReviseInput = z.input<typeof reviseSchema>
type ReviseOutput = z.output<typeof reviseSchema>
type WithdrawInput = z.input<typeof withdrawAnnouncementSchema>
type WithdrawOutput = z.output<typeof withdrawAnnouncementSchema>

const stamp = (iso: string) => `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

type Props = {
  /** Açık panelin duyurusu; `undefined` ve `announcementId` doluysa liste yüklenirken/bulunamadı. */
  row: AnnouncementRow | undefined
  announcementId: string
  /** Liste yüklendi mi (yüklenmişse ve satır yoksa duyuru görülemiyor demektir). */
  listReady: boolean
  viewer: Viewer
  audience: string
  onClose: () => void
}

/**
 * Duyuru ayrıntısı (sağ panel): açılınca alıcının okundu işareti bir kez yazılır (DOM-ILT-003).
 * Geri çekilen duyuruda alıcı başlığı, kategoriyi ve "Geri çekildi" işaretini görür; metni yalnız
 * yayınlayan ve yönetici görür (DOM-ILT-004). Yayınlayan ve yönetici düzeltir veya gerekçeyle
 * geri çeker; okundu sayısı yalnız onlara gelir.
 */
export function AnnouncementPanel({
  row,
  announcementId,
  listReady,
  viewer,
  audience,
  onClose,
}: Props) {
  return (
    <SidePanel
      open={announcementId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Duyuru"
    >
      {row ? (
        <AnnouncementDetail key={row.id} row={row} viewer={viewer} audience={audience} />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {listReady ? 'Duyuru bulunamadı veya görüntüleme yetkiniz yok.' : 'Duyuru yükleniyor…'}
        </p>
      )}
    </SidePanel>
  )
}

function AnnouncementDetail({
  row,
  viewer,
  audience,
}: {
  row: AnnouncementRow
  viewer: Viewer
  audience: string
}) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [withdrawing, setWithdrawing] = useState(false)
  const markRead = useMarkAnnouncementRead()
  const markedFor = useRef('')
  const { mutate } = markRead
  const needsRead = row.unread
  const id = row.id

  // Alıcı ilk kez açtığında bir kez yazılır; başarısızlık duyurunun okunmasını engellemez.
  useEffect(() => {
    if (!needsRead || markedFor.current === id) return
    markedFor.current = id
    mutate(id)
  }, [needsRead, id, mutate])

  const record = row.record
  const manage = canManageAnnouncement(record, viewer)
  return (
    <div className="grid gap-5">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge text={row.category} tone="purple" />
          {row.withdrawn ? <StatusBadge text="Geri çekildi" tone="red" /> : null}
          {row.revised && !row.withdrawn ? <StatusBadge text="Güncellendi" tone="amber" /> : null}
          {row.status === STATUS_UNREAD ? <StatusBadge text="Okunmadı" tone="gray" /> : null}
        </div>
        <h3 className="text-xl font-semibold [overflow-wrap:anywhere]">{row.title}</h3>
        <p className="text-sm text-muted-foreground">
          Yayın: {row.date ? stamp(row.date) : '—'}
          {record.revisedAt ? ` · Güncelleme: ${stamp(record.revisedAt)}` : ''}
        </p>
      </header>

      {mode === 'edit' ? (
        <ReviseForm row={row} onDone={() => setMode('view')} />
      ) : (
        <>
          {row.withdrawn ? (
            <WithdrawnNotice row={row} />
          ) : hasText(record) ? (
            <p className="text-base leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">
              {record.text}
            </p>
          ) : null}
          <dl className="grid gap-0 text-sm">
            <Fact label="Hedef kitle" value={audience || '—'} />
            {row.read ? <Fact label="Okundu" value={row.read} /> : null}
            {record.revisions?.length ? (
              <Fact label="Önceki sürümler" value={String(record.revisions.length)} />
            ) : null}
          </dl>
          {manage ? (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button variant="secondary" onClick={() => setMode('edit')}>
                Düzelt
              </Button>
              <Button variant="outline" onClick={() => setWithdrawing(true)}>
                Geri çek
              </Button>
            </div>
          ) : null}
        </>
      )}
      <WithdrawModal row={row} open={withdrawing} onClose={() => setWithdrawing(false)} />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2.5 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

/** Geri çekilen duyuru: alıcıya metin yerine sakin bir bilgi; yetkiliye gerekçe de gösterilir. */
function WithdrawnNotice({ row }: { row: AnnouncementRow }) {
  const { record } = row
  return (
    <div className="grid gap-2 rounded-card border bg-surface-soft p-4 text-sm">
      <p className="font-medium">
        Bu duyuru {record.withdrawnAt ? stamp(record.withdrawnAt) : ''} tarihinde geri çekildi.
      </p>
      {hasText(record) ? (
        <p className="leading-relaxed whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
          {record.text}
        </p>
      ) : (
        <p className="text-muted-foreground">Duyurunun metni artık görüntülenemiyor.</p>
      )}
      {record.withdrawReason ? (
        <p>
          <span className="text-muted-foreground">Geri çekme gerekçesi: </span>
          {record.withdrawReason}
        </p>
      ) : null}
    </div>
  )
}

function ReviseForm({ row, onDone }: { row: AnnouncementRow; onDone: () => void }) {
  const revise = useReviseAnnouncement()
  const current = {
    title: row.record.title ?? '',
    text: row.record.text ?? '',
    category: ANNOUNCEMENT_CATEGORIES.find((item) => item === row.record.category) ?? 'Akademik',
  }
  const form = useForm<ReviseInput, unknown, ReviseOutput>({
    resolver: zodResolver(reviseSchema),
    defaultValues: current,
  })
  const errors = form.formState.errors
  const busy = revise.isPending || form.formState.isSubmitting

  const onSubmit = form.handleSubmit(async (values) => {
    const changes = reviseChanges(current, values)
    if (Object.keys(changes).length === 0) {
      notify.info('Duyuruda değişiklik yok.')
      return
    }
    const outcome = await revise.submit(
      { announcementId: row.id, version: row.version, changes },
      { setError: form.setError },
    )
    if (outcome.status === 'success') {
      notify.success('Duyuru güncellendi.')
      onDone()
    }
  })

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
      <FormField id="duzelt-baslik" label="Başlık" error={errors.title}>
        {(control) => <Input {...control} {...form.register('title')} disabled={busy} />}
      </FormField>
      <FormField id="duzelt-kategori" label="Kategori" error={errors.category}>
        {(control) => (
          <NativeSelect {...control} {...form.register('category')} disabled={busy}>
            {ANNOUNCEMENT_CATEGORIES.map((category) => (
              <NativeSelectOption key={category} value={category}>
                {category}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="duzelt-metin" label="Duyuru metni" error={errors.text}>
        {(control) => <Textarea {...control} {...form.register('text')} rows={6} disabled={busy} />}
      </FormField>
      <p className="text-xs text-muted-foreground">
        Hedef kitle yayında sabitlenir. Önceki içerik geçmişte kalır; alıcılar “Güncellendi”
        işaretini görür.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} aria-busy={busy}>
          Değişikliği kaydet
        </Button>
        <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>
          Vazgeç
        </Button>
      </div>
    </form>
  )
}

function WithdrawModal({
  row,
  open,
  onClose,
}: {
  row: AnnouncementRow
  open: boolean
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Duyuruyu geri çek"
      description="Duyuru silinmez; alıcılar başlığı ve “Geri çekildi” işaretini görmeye devam eder, metin yalnız sizde ve yönetimde kalır."
    >
      {open ? <WithdrawForm row={row} onClose={onClose} /> : null}
    </Modal>
  )
}

function WithdrawForm({ row, onClose }: { row: AnnouncementRow; onClose: () => void }) {
  const withdraw = useWithdrawAnnouncement()
  const form = useForm<WithdrawInput, unknown, WithdrawOutput>({
    resolver: zodResolver(withdrawAnnouncementSchema),
    defaultValues: { reason: '' },
  })
  const busy = withdraw.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await withdraw.submit(
      { announcementId: row.id, version: row.version, reason: values.reason },
      { setError: form.setError },
    )
    if (outcome.status === 'success') {
      notify.success('Duyuru geri çekildi.')
      onClose()
    }
  })
  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
      <FormField
        id="geri-cekme-gerekce"
        label="Geri çekme gerekçesi"
        error={form.formState.errors.reason}
      >
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={4} disabled={busy} />
        )}
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy}>
          Geri çek
        </Button>
      </div>
    </form>
  )
}
