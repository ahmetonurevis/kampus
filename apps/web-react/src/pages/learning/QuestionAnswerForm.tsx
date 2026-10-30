import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { useAnswerQuestion } from '@kampus/react-shared/use-question-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummarySection } from '../management/SummaryParts.tsx'
import { focusFirstError } from '../requests/request-forms.ts'
import { answerDefaults, answerFormSchema, type AnswerFormValues } from './question-forms.ts'
import type { QuestionRow } from './question-rows.ts'

type Output = z.output<typeof answerFormSchema>

/** Sınıfın dersinden alınan öğretmenin ek yanıtı reddedilir (403; DOM-ILT-092). */
const TEACHER_REASSIGNED = 'question_teacher_reassigned'
const REASSIGNED_NOTE = 'Bu derse artık girmediğiniz için ek yanıt yazamazsınız.'

type Props = {
  /** Sorgudaki güncel satır; formun kendi tabanı değil, yalnız tazelenme sinyalidir. */
  row: QuestionRow
  /** Güncel soruyu yeniden okur; gönderim ve çakışma sonrası form bununla tazelenir. */
  reload: () => Promise<QuestionRow | null>
}

/**
 * Atanmış öğretmenin yanıt ve ek yanıt formu (Vue "Yanıtınız"). Yanıt verildikten sonra
 * değiştirilemez; düzeltme ek yanıtla yapılır (DOM-ILT-092), bu yüzden düzenleme yoktur. `If-Match`
 * formun kurulduğu (ya da son tazelendiği) andaki sürümden gider (`base`): sorgu arkadan yeni sürüm
 * getirse bile kirli form eski sürümle gönderir ve sunucu 409 verir; öğretmen güncel soruyu görmeden
 * yanıt yazmaz. Kirli değilse form yeni sürüme sessizce geçer. 409'da Türkçe toast çıkar, soru
 * yeniden okunur ve yazılan metin korunur. Kural hataları (yanıt sınırı) alanın altında görünür.
 * Başlık, etiket ve düğme aynı kaynaktan (`base`) türer; böylece kirli formda soru başka yerde
 * yanıtlansa da üçü birbiriyle tutarlı kalır.
 *
 * Dersten alınan öğretmenin 403'ü (`question_teacher_reassigned`) toast çıkarmaz: form yerine sakin
 * bir bilgi notu ve yazılan metnin salt okunur kopyası görünür. Atama istemcide güvenle bilinemez
 * (öğretmen artık o sınıfın atamalarını ve öğrencisini okuyamaz), bu yüzden form ilk 403'ten sonra
 * kapanır; sunucu tek doğruluk kaynağıdır.
 */
export function QuestionAnswerForm({ row, reload }: Props) {
  const answer = useAnswerQuestion()
  const [base, setBase] = useState<QuestionRow>(row)
  /** Sunucu dersten alındığımızı bildirdiyse: gönderilemeyen metin burada kalır. */
  const [rejectedText, setRejectedText] = useState<string | null>(null)
  const form = useForm<AnswerFormValues, unknown, Output>({
    resolver: zodResolver(answerFormSchema),
    defaultValues: answerDefaults(),
  })
  const busy = answer.isPending || form.formState.isSubmitting
  const dirty = form.formState.isDirty
  const errors = form.formState.errors
  const followUp = base.state === 'answered'

  // Sorgu arkadan yeni sürüm getirdiyse ve kullanıcı forma dokunmadıysa taban sessizce yenilenir
  // (render sırasında kendi state'inin ayarlanması); kirli form eski tabanda kalır.
  if (row.version !== base.version && !dirty) setBase(row)

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await answer.submit(
      { questionId: base.id, version: base.version, body: { text: values.text } },
      {
        setError: focusFirstError(form.setError),
        // Bu hata formun yerine geçen notla bildirilir; toast ikinci bir kopya olurdu.
        silent: (error) => error.code === TEACHER_REASSIGNED,
      },
    )
    if (outcome.status === 'success') {
      notify.success(followUp ? 'Ek yanıtınız gönderildi.' : 'Yanıtınız öğrenciye iletildi.')
      form.reset(answerDefaults())
      const fresh = await reload()
      if (fresh) setBase(fresh)
    } else if (outcome.status === 'failed' && outcome.error.code === TEACHER_REASSIGNED) {
      setRejectedText(form.getValues('text'))
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') {
      // Toast sürüm çakışmasını söyler; taban güncel soruya döner, yazılan metin kaybolmaz.
      const fresh = await reload()
      if (fresh) setBase(fresh)
    }
  })

  const label = followUp ? 'Ek yanıt' : 'Yanıtınız'
  const title = followUp ? 'Ek yanıt yaz' : 'Soruyu yanıtla'
  if (rejectedText !== null)
    return (
      <SummarySection title={title}>
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Icon name="Info" size={17} aria-hidden="true" className="mt-0.5 shrink-0" />
          {REASSIGNED_NOTE}
        </p>
        {rejectedText.trim() ? (
          <FormField
            id="soru-yanit-gonderilmedi"
            label="Yazdığınız metin (gönderilmedi)"
            description="Metin kaydedilmedi; gerekirse kopyalayabilirsiniz."
          >
            {(control) => <Textarea {...control} value={rejectedText} readOnly rows={6} />}
          </FormField>
        ) : null}
      </SummarySection>
    )
  return (
    <SummarySection title={title}>
      <form
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField
          id="soru-yanit"
          label={label}
          description={
            followUp
              ? 'Verilen yanıt değiştirilemez; düzeltme veya ek bilgi için ek yanıt yazın.'
              : 'Yanıt gönderildikten sonra değiştirilemez; düzeltme ek yanıtla yapılır.'
          }
          error={errors.text}
        >
          {(control) => (
            <Textarea {...control} {...form.register('text')} rows={6} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div className="flex justify-end">
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            <Icon name="Send" size={17} aria-hidden="true" />
            {followUp ? 'Ek yanıtı gönder' : 'Yanıtı gönder'}
          </Button>
        </div>
      </form>
    </SummarySection>
  )
}
