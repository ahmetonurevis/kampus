import { useMemo } from 'react'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import type { TargetNames } from './task-model.ts'

/**
 * Sınıf/grup ve öğrenci adları. Kayıtlar çağıranın kapsamındadır (sunucu uygular): öğretmen yalnız
 * ders verdiği ve danışmanı olduğu sınıfları ve öğrencilerini okur; kapsam dışı kimlik adsız kalır
 * ve genel bir etiketle gösterilir (başkasının öğrencisinin adı istemciye gelmez).
 * TODO(W22b-ogrenci-adi): Teslim listesi öğrenci adını kendisi taşımıyor; sayfalı öğrenci arama
 * ucu gelince yalnız görünen sayfanın öğrencileri çekilir.
 */
export function useTaskLookups(options: { students?: boolean } = {}) {
  const classes = useCoreAll('classes')
  const students = useCoreAll('students', {}, { enabled: options.students ?? true })
  const classNames = useMemo(
    () => new Map((classes.data ?? []).map(({ record }) => [record.id, record.name])),
    [classes.data],
  )
  const studentNames = useMemo(
    () => new Map((students.data ?? []).map(({ record }) => [record.id, record.name])),
    [students.data],
  )
  const names = useMemo<TargetNames>(
    () => ({
      className: (id) => classNames.get(id) ?? 'Sınıf',
      studentName: (id) => studentNames.get(id) ?? 'Öğrenci',
    }),
    [classNames, studentNames],
  )
  const classOptions = useMemo(
    () =>
      [...classNames]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true })),
    [classNames],
  )
  return { names, classOptions, classes, students }
}
