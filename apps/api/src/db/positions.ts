/**
 * `records.position`: kaydın school-core dizisindeki sırası (veritabani.md §3). Core diziyi
 * sırayla okur (başa ekleme, ilk N kayıt …); depo kimliğe göre değil bu kolona göre yükler.
 *
 * Değerler seyrek tamsayıdır (adım `POSITION_STEP`): başa ekleme en küçükten bir adım küçük,
 * sona ekleme en büyükten bir adım büyük, araya ekleme komşuların arasındaki değeri alır. Ara
 * kalmadığında yalnız o koleksiyon baştan numaralanır. Her işlemde bütün satırlar yeniden
 * yazılmaz: yerinde kalan kayıtların değeri değişmez.
 */
export const POSITION_STEP = 1024

/**
 * Yeni dizilim için sıra değerleri. `current[i]`, işlemden sonraki dizinin i. kaydının saklanan
 * sırasıdır (yeni kayıtta `null`). Dönen dizi kesin artandır; olabildiğince çok kaydın değeri
 * korunur (saklanan değerlerin en uzun artan alt dizisi yerinde kalır), kalanlar aralara yerleşir.
 */
export function planPositions(current: readonly (number | null)[]): number[] {
  const kept = longestIncreasing(current)
  const planned: (number | null)[] = current.map((value, index) => (kept.has(index) ? value : null))
  let index = 0
  while (index < planned.length) {
    if (planned[index] !== null) {
      index += 1
      continue
    }
    let end = index
    while (end < planned.length && planned[end] === null) end += 1
    const lower = index > 0 ? (planned[index - 1] ?? null) : null
    const upper = end < planned.length ? (planned[end] ?? null) : null
    const run = fillRun(lower, upper, end - index)
    if (run === null) return renumber(current.length)
    for (let offset = 0; offset < run.length; offset += 1)
      planned[index + offset] = run[offset] ?? 0
    index = end
  }
  return planned.map((value) => value ?? 0)
}

/** Baştan numaralama: 0, adım, 2·adım … */
export function renumber(length: number): number[] {
  return Array.from({ length }, (_, index) => index * POSITION_STEP)
}

/** `lower` ile `upper` arasına (ikisi de hariç) `count` artan tamsayı; sığmazsa `null`. */
function fillRun(lower: number | null, upper: number | null, count: number): number[] | null {
  const steps = Array.from({ length: count }, (_, offset) => offset)
  if (lower === null && upper === null) return steps.map((offset) => offset * POSITION_STEP)
  if (lower === null && upper !== null)
    return steps.map((offset) => upper - (count - offset) * POSITION_STEP)
  if (lower !== null && upper === null)
    return steps.map((offset) => lower + (offset + 1) * POSITION_STEP)
  if (lower === null || upper === null) return null
  const gap = upper - lower
  if (gap < count + 1) return null
  return steps.map((offset) => lower + Math.floor((gap * (offset + 1)) / (count + 1)))
}

/** Saklanan değerlerin en uzun kesin artan alt dizisinin indeksleri (O(n log n)). */
function longestIncreasing(values: readonly (number | null)[]): Set<number> {
  // tails[k]: uzunluğu k+1 olan artan alt dizilerin en küçük son elemanının indeksi.
  const tails: number[] = []
  const previous = new Map<number, number>()
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === null || value === undefined) continue
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      const tail = values[tails[middle] ?? 0] ?? 0
      if (tail < value) low = middle + 1
      else high = middle
    }
    if (low > 0) previous.set(index, tails[low - 1] ?? 0)
    tails[low] = index
  }
  const kept = new Set<number>()
  let cursor = tails[tails.length - 1]
  while (cursor !== undefined) {
    kept.add(cursor)
    cursor = previous.get(cursor)
  }
  return kept
}
