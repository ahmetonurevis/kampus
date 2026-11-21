import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { approvalFormSchema, type ApprovalFormValues } from '@kampus/react-shared/contract-model.ts'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  useApproveContract,
  type ContractTarget,
} from '@kampus/react-shared/use-contract-commands.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { notify } from '@/lib/notify.ts'

/**
 * Sözleşme onayı (IST-092, DOM-FIN-010): kabul kutusu, gönderim ve taze oturum akışı. Parola
 * doğrulanınca oturum kuruma yeniden bağlanır ve sorgular baştan yüklenir; bu sırada panel
 * "yükleniyor"a düşer. Kanca bu yüzden formu çizen bileşende değil, yükleme sırasında da yerinde
 * kalan ayrıntı bileşeninde çağrılır: bekleyen onay vazgeçilmiş sayılmaz, kutunun durumu korunur.
 * `reauthModal` o bileşenin her dalında çizilmelidir.
 */
export function useContractApproval({
  successMessage,
  onSuccess,
  onConflict,
}: {
  successMessage: string
  onSuccess: () => void
  /** 409 (sürüm değişti, zaten onaylı): sorgular tazelendi, form kapanır. */
  onConflict?: () => void
}) {
  const approve = useApproveContract()
  const { run, reauthModal } = useReauthRetry()
  const form = useForm<ApprovalFormValues>({
    resolver: zodResolver(approvalFormSchema),
    defaultValues: { accepted: false },
  })
  const busy = approve.isPending || form.formState.isSubmitting

  const submitFor = (target: ContractTarget) =>
    form.handleSubmit(async () => {
      const outcome = await run(() =>
        approve.submit(target, {
          silent: isReauthenticationRequired,
          setError: (name, error) => {
            if (name === 'accepted') form.setError('accepted', error, { shouldFocus: true })
            else form.setError('root.server', error)
          },
        }),
      )
      if (outcome.status !== 'done') return
      const result = outcome.result
      if (result.status === 'success') {
        notify.success(successMessage)
        form.reset()
        onSuccess()
      } else if (result.status === 'failed' && result.error.status === 409) onConflict?.()
    })

  return { form, busy, submitFor, reauthModal }
}

export type ContractApproval = ReturnType<typeof useContractApproval>
