import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { gradeUpdateSchema } from '@kampus/school-core/lib/grades.ts'
import { useUpdateGrade } from '@kampus/react-shared/use-academic-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCoreItem, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { scoreText, scoreTone, type AcademicLookups } from './academic-rows.ts'

type GradeRecord = CoreRecord<'grades'>
type CorrectionInput = z.input<typeof gradeUpdateSchema>
type CorrectionOutput = z.output<typeof gradeUpdateSchema>

type Props = {
  gradeId: string
  lookups: AcademicLookups
  /** Notu düzeltebilen öğretmen mi (yalnız kendi dersi ve sınıfı); yoksa panel yalnız okunur. */
  canCorrect?: (record: GradeRecord) => boolean
  onClose: () => void
}

/**
 * Not ayrıntısı: kayıt tek kayıt ucundan okunur; kapsam dışı veya olmayan not 404 olur ve
 * Türkçe "bulunamadı" mesajı gösterilir (varlığı sızdırılmaz). Atanmış ders öğretmeni gerekçeli
 * düzeltme yapabilir; eski puanlar düzeltme geçmişinde kalır (DOM-AKD-051).
 */
export function GradePanel({ gradeId, lookups, canCorrect, onClose }: Props) {
  return (
    <SidePanel
      open={gradeId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Not ayrıntısı"
    >
      {gradeId ? <GradeDetail gradeId={gradeId} lookups={lookups} canCorrect={canCorrect} /> : null}
    </SidePanel>
  )
}

function GradeDetail({ gradeId, lookups, canCorrect }: Omit<Props, 'onClose'>) {
  const item = useCoreItem('grades', gradeId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const record = item.data.record
  const student = lookups.students.get(record.studentId)
  const subject = lookups.subjects.get(record.subjectId)?.name ?? record.subject
  const corrections = record.corrections ?? []
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="Award" />}
        title={record.title}
        subtitle={`${subject} · ${dateLabel(record.date, { year: 'numeric' })}`}
        status={scoreText(record.score)}
        tone={scoreTone(record.score)}
      />
      <SummaryMetrics
        items={[
          { label: 'Öğrenci', value: student?.name ?? '—' },
          { label: 'Puan', value: scoreText(record.score) },
        ]}
      />
      <SummarySection title="Kazanım / Konu">
        <p className="text-sm">{record.topic || '—'}</p>
      </SummarySection>
      {corrections.length > 0 ? (
        <SummarySection title="Düzeltme geçmişi">
          <ul className="grid gap-2 text-sm">
            {corrections.map((correction) => (
              <li key={correction.date}>
                {scoreText(correction.previousScore)} → {scoreText(correction.score)} ·{' '}
                {dateLabel(correction.date, { year: 'numeric' })}
                <span className="block text-muted-foreground">{correction.reason}</span>
              </li>
            ))}
          </ul>
        </SummarySection>
      ) : null}
      {canCorrect?.(record) ? (
        record.quizId ? (
          <p className="mt-5 text-sm text-muted-foreground">
            Quizden aktarılan notun puanı cevaplardan hesaplanır; düzeltilemez.
          </p>
        ) : (
          <CorrectionForm
            gradeId={gradeId}
            score={record.score}
            version={item.data.version}
            // Not artık görülemiyorsa (404) panel "bulunamadı" durumuna geçer.
            onNotFound={() => void item.refetch()}
          />
        )
      ) : null}
    </>
  )
}

type CorrectionProps = {
  gradeId: string
  score: number
  version: number
  onNotFound: () => void
}

/**
 * Gerekçeli düzeltme: `If-Match` notun okunan sürümüdür. Başkası araya girdiyse 409 "kayıt
 * değişti" mesajı gösterilir ve kayıt tazelenir (yazılan gerekçe formda kalır).
 */
function CorrectionForm({ gradeId, score, version, onNotFound }: CorrectionProps) {
  const update = useUpdateGrade()
  const form = useForm<CorrectionInput, unknown, CorrectionOutput>({
    resolver: zodResolver(gradeUpdateSchema),
    defaultValues: { score, reason: '' },
  })
  const busy = update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await update.submit(
      { gradeId, score: values.score, reason: values.reason, gradeVersion: version },
      { setError: form.setError },
    )
    if (outcome.status === 'success') {
      notify.success('Not düzeltildi.')
      form.reset({ score: values.score, reason: '' })
    } else if (outcome.status === 'failed' && outcome.error.status === 404) onNotFound()
  })

  return (
    <form
      noValidate
      aria-label="Notu düzelt"
      onSubmit={(event) => void onSubmit(event)}
      className="mt-6 grid gap-4 border-t pt-5"
    >
      <h3 className="text-sm font-semibold">Notu düzelt</h3>
      <FormField id="duzeltme-puan" label="Yeni puan (0-100)" error={errors.score}>
        {(control) => (
          <Input
            {...control}
            {...form.register('score')}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="duzeltme-gerekce"
        label="Düzeltme gerekçesi"
        description="Eski puan düzeltme geçmişinde saklanır."
        error={errors.reason}
      >
        {(control) => (
          <Textarea {...control} {...form.register('reason')} maxLength={500} disabled={busy} />
        )}
      </FormField>
      {errors.root?.server?.message ? (
        <p role="alert" className="text-sm text-danger">
          {errors.root.server.message}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        <Icon name="CircleCheck" size={17} aria-hidden="true" />
        Düzeltmeyi kaydet
      </Button>
    </form>
  )
}
