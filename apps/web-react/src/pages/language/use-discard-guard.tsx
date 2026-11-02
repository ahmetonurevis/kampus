import { useCallback, useEffect, useState } from 'react'
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
 * Kirli formun kapatılması onay ister (yoklama düzeltme kalıbı, OG-041): Esc, kapatma düğmesi,
 * zemin tıklaması ve "Vazgeç" önce "Kaydedilmemiş değişiklikler" sorusunu açar. Form kirliliğini
 * `setDirty` ile bildirir; sekme kapanırken tarayıcı uyarısı da açılır.
 */
export function useDiscardGuard(onClose: () => void) {
  const [dirty, setDirty] = useState(false)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const requestClose = useCallback(() => {
    if (dirty) setAsking(true)
    else onClose()
  }, [dirty, onClose])

  /** Başarılı kayıttan sonra: soru sorulmadan kapanır. */
  const closeClean = useCallback(() => {
    setDirty(false)
    setAsking(false)
    onClose()
  }, [onClose])

  const dialog = (
    <AlertDialog open={asking} onOpenChange={(open) => (open ? undefined : setAsking(false))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kaydedilmemiş değişiklikler var</AlertDialogTitle>
          <AlertDialogDescription>
            Formdaki değişiklikler kaydedilmedi. Pencereyi kapatırsanız silinir.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Düzenlemeye devam et</AlertDialogCancel>
          <AlertDialogAction onClick={closeClean}>Değişiklikleri at</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { requestClose, closeClean, setDirty, dialog }
}

/** Formun kirliliğini koruyucuya bildirir (react-hook-form `isDirty`). */
export function useReportDirty(dirty: boolean, setDirty: (dirty: boolean) => void) {
  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])
  // Form kalkınca (pencere kapandı) koruma da düşer.
  useEffect(() => () => setDirty(false), [setDirty])
}
