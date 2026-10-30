import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { ReactNode } from 'react'
import type { Toast, ToastType } from '../store/SchoolProvider.tsx'
import { T, useColors } from '../ui/components.tsx'

type Notify = (message: string, type?: ToastType) => void
const ToastContext = createContext<Notify | null>(null)

/** API modunun geçici bildirimi (demo `notify` ile aynı görünüm ve ekran okuyucu duyurusu). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const notify = useCallback<Notify>((message, type = 'success') => {
    setToast({ message, type })
    AccessibilityInfo.announceForAccessibility(message)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 5000)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
    </ToastContext.Provider>
  )
}

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const c = useColors()
  return (
    <SafeAreaView
      edges={['bottom']}
      pointerEvents="box-none"
      style={{ paddingHorizontal: 14, paddingVertical: 10 }}
    >
      <Pressable
        accessibilityRole="alert"
        onPress={onClose}
        style={{
          backgroundColor: toast.type === 'error' ? c.redSoft : c.primarySoft,
          padding: 16,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: c.border,
        }}
      >
        <T style={{ color: toast.type === 'error' ? c.red : c.text }}>{toast.message}</T>
      </Pressable>
    </SafeAreaView>
  )
}

export function useNotify(): Notify {
  const notify = useContext(ToastContext)
  if (!notify) throw new Error('Bildirimler yalnızca API uygulaması içinde kullanılabilir.')
  return notify
}
