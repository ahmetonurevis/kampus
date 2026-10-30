import { useForm } from 'react-hook-form'
import {
  useArchiveRecord,
  useRestoreRecord,
  type ManagedKind,
} from '@kampus/react-shared/use-management-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { errorRoutes, RootError } from './FormParts.tsx'
import {
  ARCHIVE_ERROR_CODES,
  ARCHIVE_NOTES,
  archiveDestinations,
  recordName,
  transferSummary,
} from './management-forms.ts'
import type { ManagementLookups } from './management-rows.ts'

export type ArchiveTarget = { kind: ManagedKind; id: string }

type FormValues = { replacementId: string }

const ARCHIVE_FIELDS = Object.fromEntries(
  [...ARCHIVE_ERROR_CODES].map((code) => [code, 'replacementId']),
)

type Props = {
  target: ArchiveTarget | null
  lookups: ManagementLookups
  onClose: () => void
}

/**
 * Arşivleme onayı (Vue "Kaydı arşivle"): bağlı aktif kayıtların aktarılacağı hedef seçilir;
 * geçmiş finans, not ve yoklama korunur. Hedef gerektiği hâlde seçilmediyse core mesajı
 * ("Sınıf ve öğretmenlerin aktarılacağı aktif kampüsü seçin.") seçimin altında görünür.
 */
export function ArchiveDialog({ target, lookups, onClose }: Props) {
  return (
    <Modal
      open={target !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Kaydı arşivle"
    >
      {target ? (
        <ArchiveForm
          key={`${target.kind}-${target.id}`}
          target={target}
          lookups={lookups}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  )
}

function ArchiveForm({
  target,
  lookups,
  onClose,
}: Omit<Props, 'target'> & { target: ArchiveTarget }) {
  const { kind, id } = target
  const archive = useArchiveRecord(kind)
  const form = useForm<FormValues>({ defaultValues: { replacementId: '' } })
  const busy = archive.isPending || form.formState.isSubmitting
  const name = recordName(kind, id, lookups) ?? 'Kayıt'
  const destinations = archiveDestinations(kind, id, lookups)

  const onSubmit = form.handleSubmit(async ({ replacementId }) => {
    const outcome = await archive.submit(
      { recordId: id, ...(replacementId ? { replacementId } : {}) },
      { setError: form.setError, ...errorRoutes(ARCHIVE_FIELDS) },
    )
    if (outcome.status === 'success') {
      const destination = destinations.find((item) => item.id === replacementId)
      const summary = transferSummary(outcome.data.data, destination?.label)
      notify.success(
        [`${name} arşivlendi.`, summary, 'Geçmiş not, ödeme ve yoklama kayıtları korundu.']
          .filter(Boolean)
          .join(' '),
      )
      onClose()
    } else if (outcome.status === 'failed' && ARCHIVE_ERROR_CODES.has(outcome.error.code)) {
      // Aktarım hedefi hatası yalnız seçimin altında görünür; diğer hatalar toast'tur.
      form.setFocus('replacementId')
    }
  })

  return (
    <form
      noValidate
      aria-label={`${name} arşivle`}
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <div className="rounded-card border bg-surface-soft px-4 py-3">
        <strong className="text-sm font-semibold">{name}</strong>
        <p className="mt-1 text-sm text-muted-foreground">
          {ARCHIVE_NOTES[kind]} Geçmiş not, ödeme ve yoklama kayıtları korunur.
        </p>
      </div>
      <FormField
        id="arsiv-hedef"
        label="Aktarım hedefi"
        error={form.formState.errors.replacementId}
      >
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('replacementId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">
              Bağlı aktif kayıt yoksa aktarım gerekmiyor
            </NativeSelectOption>
            {destinations.map((destination) => (
              <NativeSelectOption key={destination.id} value={destination.id}>
                {destination.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <p className="text-sm text-muted-foreground">
        Arşivden yeniden etkinleştirme, aktarılmış öğrenci ve görevleri geri taşımaz.
      </p>
      <RootError message={form.formState.errors.root?.server?.message} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          <Icon name="Archive" size={17} aria-hidden="true" />
          Arşivlemeyi tamamla
        </Button>
      </div>
    </form>
  )
}

/**
 * Arşivden geri alma: onay penceresi gerekmez, tek adımdır. Sonuç toast'la bildirilir; sunucu
 * reddi (ör. bağlı kampüs hâlâ arşivde) Türkçe mesajla gösterilir ve kayıt değişmez.
 */
export function useRestoreAction(kind: ManagedKind) {
  const restore = useRestoreRecord(kind)
  return {
    pending: restore.isPending,
    async restore(id: string, name: string) {
      const outcome = await restore.submit({ recordId: id })
      if (outcome.status === 'success')
        notify.success(
          `${name} yeniden etkinleştirildi. Daha önce aktarılan öğrenci ve görevler geri taşınmaz.`,
        )
    },
  }
}
