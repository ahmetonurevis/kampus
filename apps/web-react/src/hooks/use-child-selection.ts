import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import type { Session } from '@/auth/auth-port.ts'
import { CHILD_VIEW_KEY, childScrollKey, resolveChild } from '@/lib/child-selection.ts'
import { readView, writeView } from '@/lib/view-memory.ts'

/**
 * Velinin görüntülediği çocuk (Vue `selectedChildId`). Değişince sayfa kaydırması çocuk bazında
 * saklanır ve yeni çocuğun konumu geri yüklenir. Seçenekler `/me` veli bağlantılarıdır (kayıt
 * kimliği). TODO(core-scope): veli kapsamlı okuma gelince çocuğa ait sorgular `childId`'yi
 * bu değerden alır; sunucu yine yalnız velinin bağlı çocuklarını döndürür.
 */
export function useChildSelection(session: Session | null) {
  const { pathname } = useLocation()
  const options = session?.children ?? []
  const [stored, setStored] = useState(() => readView(CHILD_VIEW_KEY))
  const childId = resolveChild(options, stored)

  function selectChild(next: string) {
    if (next === childId) return
    writeView(childScrollKey(pathname, childId), window.scrollY)
    writeView(CHILD_VIEW_KEY, next)
    setStored(next)
  }

  // Dış sistem (pencere kaydırması) ile eşitleme; ilk yüklemede ScrollRestoration'a bırakılır.
  const previous = useRef(childId)
  useLayoutEffect(() => {
    if (previous.current === childId) return
    previous.current = childId
    const top = readView(childScrollKey(pathname, childId))
    window.scrollTo({ top: typeof top === 'number' ? top : 0 })
  }, [childId, pathname])

  return { options, childId, selectChild }
}
