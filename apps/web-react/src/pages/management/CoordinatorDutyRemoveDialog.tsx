import {
  coordinatorDutyStale,
  useRemoveCoordinatorDuty,
} from '@kampus/react-shared/use-coordinator-duties.ts'
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
import { notify } from '@/lib/notify.ts'
import type { DutyTexts, DutyRow } from './coordinator-duty-rows.ts'

type Props = {
  /** Kaldırılacak görev; `null` kapalı. */
  target: DutyRow | null
  texts: DutyTexts
  onClose: () => void
}

/**
 * Görevi kaldırma onayı (DOM-YTK-027): görev arşivlenir, verdiği son puanlar kayıt geçmişinde kalır.
 * İstek görevin okunan sürümüyle (`If-Match`) gider; başkası görevi bu arada değiştirdiyse ya da
 * kaldırdıysa liste tazelenir, Türkçe uyarı çıkar ve pencere kapanır. Gönderim sürerken düğme
 * kilitli, ikinci tıklama istek atmaz.
 */
export function CoordinatorDutyRemoveDialog({ target, texts, onClose }: Props) {
  const remove = useRemoveCoordinatorDuty()

  async function confirm() {
    if (!target) return
    const outcome = await remove.submit({ dutyId: target.id, version: target.version })
    if (outcome.status === 'success') {
      notify.success(`${texts.kindLabel} görevi kaldırıldı.`)
      onClose()
    } else if (outcome.status === 'failed' && coordinatorDutyStale(outcome.error)) {
      onClose()
    }
  }

  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Görevi kaldır</AlertDialogTitle>
          <AlertDialogDescription>
            {target
              ? `${target.teacher} için ${target.scope} ${texts.kindLabel.toLocaleLowerCase('tr')} görevi kaldırılacak. Görevin verdiği son puanlar kayıt geçmişinde kalır.`
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Vazgeç</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            aria-busy={remove.isPending || undefined}
            onClick={(event) => {
              // Pencere sonuç gelene kadar açık kalır; kapanışı `confirm` yönetir.
              event.preventDefault()
              void confirm()
            }}
          >
            Görevi kaldır
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
