import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import type { Session } from '@/auth/auth-port.ts'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import {
  CHILD_PARAM,
  CHILD_VIEW_KEY,
  childScrollKey,
  resolveChildFrom,
  withChildNames,
  withChildParam,
} from '@/lib/child-selection.ts'
import { readView, writeView } from '@/lib/view-memory.ts'

const NO_STUDENTS: readonly never[] = []

/**
 * Velinin görüntülediği çocuk (Vue `selectedChildId`). Seçenekler `/me` veli bağlantılarıdır;
 * adlar velinin kapsamlı `students` okumasından gelir. Seçim adreste (`?cocuk=`) tutulur;
 * `urlMissing` doğruyken kabuk adresi seçimle tamamlar. Değişince sayfa kaydırması çocuk
 * bazında saklanır ve yeni çocuğun konumu geri yüklenir; çocuğa bağlı sorgular `childId`'yi
 * filtre olarak alır, bu yüzden çocuk değişince kendiliğinden yeniden okunur.
 */
export function useChildSelection(session: Session | null) {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const isParent = session?.role === 'veli'
  const students = useCoreAll('students', {}, { enabled: isParent })
  const children = session?.children
  const options = useMemo(
    () => withChildNames(children ?? [], students.data?.map((row) => row.record) ?? NO_STUDENTS),
    [children, students.data],
  )
  const urlChild = params.get(CHILD_PARAM)
  const childId = resolveChildFrom(options, [urlChild, readView(CHILD_VIEW_KEY)])
  const urlMissing = isParent && childId !== '' && urlChild !== childId

  function selectChild(next: string) {
    if (next === childId) return
    writeView(childScrollKey(pathname, childId), window.scrollY)
    writeView(CHILD_VIEW_KEY, next)
    void Promise.resolve(
      navigate(
        { search: withChildParam(window.location.search, next) },
        { preventScrollReset: true },
      ),
    ).catch((error: unknown) => console.error('[çocuk] seçim yazılamadı', error))
  }

  // Dış sistem (pencere kaydırması) ile eşitleme; ilk yüklemede ScrollRestoration'a bırakılır.
  const previous = useRef(childId)
  useLayoutEffect(() => {
    if (previous.current === childId) return
    previous.current = childId
    const top = readView(childScrollKey(pathname, childId))
    window.scrollTo({ top: typeof top === 'number' ? top : 0 })
  }, [childId, pathname])

  // Görünüm belleği: menü bağlantılarıyla (adresi `?cocuk=`suz) gelinirse son seçim korunur.
  useEffect(() => {
    if (isParent && childId) writeView(CHILD_VIEW_KEY, childId)
  }, [isParent, childId])

  return {
    options,
    childId,
    selectChild,
    urlMissing,
    names: { error: students.error, retry: () => void students.refetch() },
  }
}
