import { useRef } from 'react'
import { useBlocker } from 'react-router'
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

/**
 * Kirli form koruması: pencere kapatma ve sayfa içi gezinme (geri, bağlantı) aynı yoldan geçer;
 * form kirliyse gezinme durur ve onay sorulur. Başarılı gönderimden sonra `leave()` korumayı
 * kaldırır (form sıfırlanmadan kapanır).
 */
export function useRouteDiscardGuard(dirty: boolean) {
  const leaving = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !leaving.current &&
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  )
  const dialog = (
    <AlertDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kaydedilmemiş değişiklikler var</AlertDialogTitle>
          <AlertDialogDescription>
            Formdaki değişiklikler kaydedilmedi. Kapatırsanız silinir.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Düzenlemeye devam et</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Radix kendi kapanışını yapmasın; gezinme sürer ve pencere kapanır.
              event.preventDefault()
              if (blocker.state === 'blocked') blocker.proceed()
            }}
          >
            Değişiklikleri at
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return {
    dialog,
    leave: () => {
      leaving.current = true
    },
  }
}
