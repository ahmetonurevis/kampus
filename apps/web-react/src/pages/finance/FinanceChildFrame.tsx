import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import type { PayerChildView } from '@kampus/react-shared/finance-payer-children.ts'
import { childNamesPending } from '@/auth/session-mapping.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { useFinanceChild, type FinanceChildOption } from './use-finance-child.ts'

/** Sayfa gövdesinin aldığı seçili çocuk; ödeyici çocukta ad ve sınıf seçici listesinden gelir. */
export type FinanceChild = { id: string; payer: PayerChildView | undefined }

/**
 * Veli finans sayfalarının çerçevesi (ON-313; K-04, DOM-FIN-052, DOM-ILT-074): başlık, seçili
 * çocuk ve ödeyicisi olunan çocuk varken finans çocuk seçicisi. Gövde çocuk değişince yeniden
 * kurulur; görünüm kapsamı (`ViewScopeContext`, liste belleği) seçili finans çocuğudur.
 */
export function FinanceChildFrame({
  page,
  children,
}: {
  page: NavPage
  children: (child: FinanceChild) => ReactNode
}) {
  const finance = useFinanceChild()
  const location = useLocation()
  const learner = useEnrollmentLearner()
  if (finance.cleanSearch !== null)
    return (
      <Navigate
        to={{ pathname: location.pathname, search: finance.cleanSearch, hash: location.hash }}
        replace
      />
    )
  let body: ReactNode
  if (finance.status === 'loading')
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        {learner.title}ler yükleniyor…
      </p>
    )
  else if (finance.status === 'error')
    body = <QueryError error={finance.error} onRetry={finance.retry} />
  else if (!finance.childId)
    body = (
      <EmptyState
        title={`Bağlı ${learner.noun} bulunamadı.`}
        description={`Hesabınıza bağlı bir ${learner.noun} olduğunda ödeme bilgileri burada görünür.`}
      />
    )
  else
    body = (
      <>
        {finance.options.length > 0 ? (
          <FinanceChildBar
            options={finance.options}
            value={finance.childId}
            payerOnly={finance.payerChild !== undefined}
            onChange={finance.selectChild}
          />
        ) : null}
        <ViewScopeContext key={finance.childId} value={finance.childId}>
          {children({ id: finance.childId, payer: finance.payerChild })}
        </ViewScopeContext>
      </>
    )
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {body}
    </>
  )
}

/**
 * Finans çocuk seçicisi: velayetli çocuklar ve ödeyicisi olunan çocuklar. Ödeyici çocuk
 * seçiliyken yalnız ödeme bilgisinin göründüğü yazılır (akademik bilgi bu bağla açılmaz).
 */
function FinanceChildBar({
  options,
  value,
  payerOnly,
  onChange,
}: {
  options: readonly FinanceChildOption[]
  value: string
  payerOnly: boolean
  onChange: (childId: string) => void
}) {
  const pending = childNamesPending(options)
  const learner = useEnrollmentLearner()
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-surface px-[18px] py-3 text-sm">
      <span className="flex items-center gap-2 font-medium text-primary">
        <Icon name="Wallet" size={18} aria-hidden="true" />
        Ödemesi görüntülenen {learner.noun}
      </span>
      <NativeSelect
        aria-label={`Ödemesi görüntülenen ${learner.noun}`}
        aria-busy={pending || undefined}
        disabled={pending}
        value={pending ? '' : value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 bg-surface py-[5px] pr-7 pl-2.5 text-sm"
      >
        {pending ? (
          <NativeSelectOption value="">{learner.title}ler yükleniyor…</NativeSelectOption>
        ) : (
          options.map((child) => (
            <NativeSelectOption key={child.id} value={child.id}>
              {child.name}
            </NativeSelectOption>
          ))
        )}
      </NativeSelect>
      <span className="text-xs text-muted-foreground sm:ml-auto">
        {payerOnly
          ? `Ödeyicisi olduğunuz ${learner.genitive} yalnız ödeme bilgileri gösterilir.`
          : `Ödeyicisi olduğunuz ${learner.plural}in ödemelerini de buradan seçebilirsiniz.`}
      </span>
    </div>
  )
}
