import { useMemo } from 'react'
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
import { useStableCallback } from '@/hooks/use-stable-callback.ts'
import { notify } from '@/lib/notify.ts'
import { errorRoutes, RootError, useFocusAfterSubmit } from './FormParts.tsx'
import {
  ARCHIVE_ERROR_CODES,
  ARCHIVE_NOTES,
  archiveDependents,
  archiveDestinations,
  NO_DESTINATION,
  recordName,
  transferSummary,
} from './management-forms.ts'
import type { ManagementLookups } from './management-rows.ts'

export type ArchiveTarget = { kind: ManagedKind; id: string }

type FormValues = { replacementId: string }

const ARCHIVE_ROUTES = errorRoutes(
  Object.fromEntries([...ARCHIVE_ERROR_CODES].map((code) => [code, 'replacementId'])),
)

type Props = {
  target: ArchiveTarget | null
  lookups: ManagementLookups
  onClose: () => void
}

/**
 * Arşivleme onayı (Vue "Kaydı arşivle"; IST-010): bağlı aktif kayıtların aktarılacağı hedef
 * seçilir; geçmiş finans, not ve yoklama korunur. Ekranda bilinen bağlı kayıtlar (öğrenci, sınıf,
 * öğretmen, ders ataması) pencerede sayılır ve hedef seçimi istenir. Hedef gerektiği hâlde
 * seçilmediyse ya da hedef uygun değilse (kontenjan, branş, program veya ad/derslik çakışması)
 * core mesajı ("Hedef sınıfta tüm öğrenciler için yeterli kontenjan yok.") seçimin altında
 * görünür; diğer redler (ör. gelecek etüt) toast'tur. Pencere tek seçimlidir, kirli form onayı
 * gerekmez: vazgeçmek hiçbir kaydı değiştirmez.
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
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const name = recordName(kind, id, lookups) ?? 'Kayıt'
  const destinations = archiveDestinations(kind, id, lookups)
  const dependents = archiveDependents(kind, id, lookups)
  const needsTarget = dependents.length > 0

  const onSubmit = form.handleSubmit(async ({ replacementId }) => {
    const outcome = await archive.submit(
      { recordId: id, ...(replacementId ? { replacementId } : {}) },
      { setError: form.setError, ...ARCHIVE_ROUTES },
    )
    if (outcome.status === 'success') {
      // Toast'ta hedefin yalnız adı (seçenek etiketindeki boş yer bilgisi arşivden önceki durumdur).
      const destination = replacementId ? recordName(kind, replacementId, lookups) : undefined
      const summary = transferSummary(outcome.data.data, destination)
      notify.success(
        [`${name} arşivlendi.`, summary, 'Geçmiş not, ödeme ve yoklama kayıtları korundu.']
          .filter(Boolean)
          .join(' '),
      )
      onClose()
    } else if (outcome.status === 'failed') {
      // Aktarım hedefi hatası yalnız seçimin altında görünür; diğer hatalar toast'tur.
      focusAfterSubmit(ARCHIVE_ROUTES.fieldFor(outcome.error))
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
        {needsTarget ? (
          <p className="mt-2 text-sm">
            <span className="font-medium">Bağlı aktif kayıtlar:</span> {dependents.join(', ')}.
            Arşivlemek için aktarım hedefi seçin.
          </p>
        ) : null}
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
              {needsTarget ? 'Aktarım hedefi seçin' : 'Bağlı aktif kayıt yoksa aktarım gerekmiyor'}
            </NativeSelectOption>
            {destinations.map((destination) => (
              <NativeSelectOption key={destination.id} value={destination.id}>
                {destination.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {needsTarget && destinations.length === 0 ? (
        <p role="status" className="text-sm font-medium">
          {NO_DESTINATION[kind]}
        </p>
      ) : null}
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
 * reddi (ör. bağlı kampüs hâlâ arşivde) Türkçe mesajla gösterilir ve kayıt değişmez. Dönen nesne
 * yalnız `pending` değişince yenilenir (tablo sütunları her çizimde yeniden kurulmasın).
 */
export function useRestoreAction(kind: ManagedKind) {
  const command = useRestoreRecord(kind)
  const restore = useStableCallback((id: string, name: string) => {
    void command.submit({ recordId: id }).then((outcome) => {
      if (outcome.status === 'success')
        notify.success(
          `${name} yeniden etkinleştirildi. Daha önce aktarılan öğrenci ve görevler geri taşınmaz.`,
        )
    })
  })
  const pending = command.isPending
  return useMemo(() => ({ pending, restore }), [pending, restore])
}
