import { useEffect, useRef } from 'react'
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

/** Onay penceresinin metinleri; verilmeyen alan form metnidir. */
export interface DiscardGuardTexts {
  title?: string
  description?: string
  cancel?: string
  confirm?: string
}

/**
 * Kirli form koruması: pencere kapatma ve sayfa içi gezinme (geri, bağlantı) aynı yoldan geçer;
 * form kirliyse gezinme durur ve onay sorulur. Sekme kapatma ve sayfa yenileme tarayıcının kendi
 * uyarısını (`beforeunload`) açar. Başarılı gönderimden sonra `leave()` korumayı kaldırır (form
 * sıfırlanmadan kapanır). `texts` formdan farklı bir ekranın (ör. quiz çözme) metnini verir.
 */
export function useRouteDiscardGuard(dirty: boolean, texts: DiscardGuardTexts = {}) {
  const leaving = useRef(false)
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      if (leaving.current) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
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
          <AlertDialogTitle>{texts.title ?? 'Kaydedilmemiş değişiklikler var'}</AlertDialogTitle>
          <AlertDialogDescription>
            {texts.description ?? 'Formdaki değişiklikler kaydedilmedi. Kapatırsanız silinir.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{texts.cancel ?? 'Düzenlemeye devam et'}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Radix kendi kapanışını yapmasın; gezinme sürer ve pencere kapanır.
              event.preventDefault()
              if (blocker.state === 'blocked') blocker.proceed()
            }}
          >
            {texts.confirm ?? 'Değişiklikleri at'}
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
