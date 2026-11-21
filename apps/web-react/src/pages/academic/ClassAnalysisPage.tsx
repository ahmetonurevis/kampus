import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { LookupError } from './AcademicParts.tsx'
import { classOptions } from './class-analysis-model.ts'
import { GradeAnalysis } from './GradeAnalysis.tsx'
import { useAcademicLookups } from './use-academic-lookups.ts'

/**
 * Sınıf Analizi (öğretmen, Vue `Academic.vue` `sinif-analizi`): seçili sınıfın ders ve konu bazlı
 * başarısı ile aylık not eğilimi. Sınıf seçimi adreste (`?sinif=`) tutulur. Sınıf, öğrenci ve not
 * kapsamını sunucu uygular: öğretmen yalnız ders verdiği ve danışmanı olduğu sınıfları, kendi
 * branşının (rehber olduğu sınıfta bütün) notlarını görür. Yalnız okuma; ortalama kayıtlardan
 * hesaplanır.
 */
export function ClassAnalysisPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const [params, setParams] = useSearchParams()
  const { lookups, sources, pending, error, retry } = useAcademicLookups()
  const options = useMemo(() => classOptions(sources.classes, lookups.branches), [sources, lookups])

  const requested = params.get('sinif')
  const selected = options.find((item) => item.id === requested) ?? options[0]

  const selectClass = (id: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set('sinif', id)
        // Seçili ders başka sınıfta bulunmayabilir; yeni sınıf "Tüm dersler"le açılır.
        next.delete('ders')
        return next
      },
      { preventScrollReset: true },
    )

  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          options.length > 0 ? (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="sr-only">Sınıf seç</span>
              <NativeSelect
                aria-label="Sınıf seç"
                value={selected?.id ?? ''}
                onChange={(event) => selectClass(event.target.value)}
                className="min-h-9 text-sm"
              >
                {options.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : null
        }
      />
      {error ? <LookupError error={error} onRetry={retry} /> : null}
      {selected ? (
        <GradeAnalysis
          key={selected.id}
          scope={{ classId: selected.id }}
          classId={selected.id}
          lookups={lookups}
        />
      ) : !pending && !error ? (
        <EmptyState
          title="Sınıf bulunamadı."
          description="Ders verdiğiniz bir sınıf olduğunda sınıf analizi burada görünür."
        />
      ) : null}
    </>
  )
}
