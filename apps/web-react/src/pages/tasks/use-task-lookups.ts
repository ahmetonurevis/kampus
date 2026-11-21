import { useMemo } from 'react'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import type { TargetNames } from './task-model.ts'

/**
 * Sınıf/grup adları. Kayıtlar çağıranın kapsamındadır (sunucu uygular): öğretmen yalnız ders
 * verdiği sınıfları okur; kapsam dışı kimlik adsız kalır ve genel bir etiketle gösterilir.
 * Öğrenci adı burada çözülmez: teslim ve deneme satırları adı kendisi taşır (`learnerName`,
 * OG-213; `learnerLabel`), bütün öğrenci listesi çekilmez.
 */
export function useTaskLookups() {
  const classes = useCoreAll('classes')
  const classNames = useMemo(
    () => new Map((classes.data ?? []).map(({ record }) => [record.id, record.name])),
    [classes.data],
  )
  const names = useMemo<TargetNames>(
    () => ({ className: (id) => classNames.get(id) ?? 'Sınıf' }),
    [classNames],
  )
  const classOptions = useMemo(
    () =>
      [...classNames]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true })),
    [classNames],
  )
  return { names, classOptions, classes }
}
