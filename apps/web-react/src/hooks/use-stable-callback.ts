import { useEffect, useState } from 'react'

/**
 * Kimliği hiç değişmeyen ama her zaman en güncel işlevi çağıran sarmalayıcı kutusu (saf; kanca ve
 * test aynısını kullanır). Zamanlayıcı kuran effect'lerin bağımlılığına verilebilir.
 */
export function createLatestCaller<TArgs extends unknown[]>(initial: (...args: TArgs) => void) {
  let current = initial
  return {
    update: (next: (...args: TArgs) => void) => {
      current = next
    },
    call: (...args: TArgs) => current(...args),
  }
}

/** Her render'da yenilenen `callback`'i çağıran, kimliği sabit işlev. */
export function useStableCallback<TArgs extends unknown[]>(callback: (...args: TArgs) => void) {
  const [latest] = useState(() => createLatestCaller(callback))
  useEffect(() => latest.update(callback))
  return latest.call
}
