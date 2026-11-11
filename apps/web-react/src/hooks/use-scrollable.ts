import { useCallback, useEffect, useState } from 'react'

type Box = Pick<HTMLElement, 'clientHeight' | 'clientWidth' | 'scrollHeight' | 'scrollWidth'>

/** İçerik kutudan taşıyorsa (alt piksel yuvarlama payı 1 px) bölge gerçekten kayar. */
export const isScrollable = (box: Box) =>
  box.scrollHeight - box.clientHeight > 1 || box.scrollWidth - box.clientWidth > 1

/**
 * Bölgenin içeriği kutusundan taşıp taşmadığını izler (kutu ya da çocukları boyut değiştirince
 * yeniden ölçer). Kayan bölge klavyeyle odaklanmalıdır (WCAG 2.1.1); kaymayan bölge gereksiz Tab
 * durağı olmamalıdır. Dönen `ref` kayan öğeye bağlanır; `tabIndex` ve `role` için `scrollable`
 * kullanılır. İlk çizimde `false` döner, ölçüm çizimden sonra gelir.
 */
export function useScrollable<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null)
  const [scrollable, setScrollable] = useState(false)
  const ref = useCallback((node: T | null) => setElement(node), [])
  useEffect(() => {
    if (!element) return
    const measure = () => setScrollable(isScrollable(element))
    // `observe` ilk ölçümü de bildirir; etkide eşzamanlı state yazılmaz.
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    return () => observer.disconnect()
  }, [element])
  return { ref, scrollable }
}
