import { useMemo } from 'react'
import { withPayerChildren } from '@kampus/react-shared/finance-payer-children.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { useFinancePayerChildren } from '@kampus/react-shared/use-finance-payer-children.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { childOptions, type ChildOption } from './parent-child-picker.tsx'

type StudentRecord = State['students'][number]
type ClassRecord = State['classes'][number]

/**
 * Veli finans ekranlarının çocuk seçeneği (ON-078, ON-313; K-04, DOM-FIN-052, DOM-ILT-074):
 * velayet kapsamındaki çocuklar (öğrenci okuması) ve velayeti olmasa da ödeyicisi olunan çocuklar
 * (`GET /finance/payer-children`; ad ve sınıf adı). Yalnız finans ve sözleşme ekranları kullanır;
 * akademik ekranlar velayet listesini okur, ödeyici çocuk orada görünmez. Ödeyici listesi
 * okunamazsa velayetli çocuklar yine seçilir; hiç çocuk yoksa hata gösterilir.
 */
export function useFinanceChildOptions(open: boolean) {
  const students = useCollectionAll<StudentRecord>('students', {}, { enabled: open })
  const classes = useCollectionAll<ClassRecord>('classes', {}, { enabled: open })
  const payer = useFinancePayerChildren({ enabled: open })
  const options = useMemo<ChildOption[]>(
    () =>
      withPayerChildren(
        childOptions(students.data ?? [], classes.data ?? []),
        payer.data?.data ?? [],
        (child) => ({ id: child.id, name: child.name, className: child.className ?? undefined }),
      ),
    [students.data, classes.data, payer.data],
  )
  const error = students.error ?? (options.length === 0 ? payer.error : null)
  return {
    options,
    loading: !students.data || payer.isPending,
    error,
    retry: () => {
      void students.refetch()
      void payer.refetch()
    },
  }
}
