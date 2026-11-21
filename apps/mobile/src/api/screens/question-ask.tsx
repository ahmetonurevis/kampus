import { useMemo, useState } from 'react'
import { View } from 'react-native'
import {
  askOptions,
  optionOf,
  teacherChoice,
  type AskValues,
} from '@kampus/react-shared/question-model.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { useAskQuestion } from '@kampus/react-shared/use-question-commands.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import {
  QUESTION_SENSITIVE_NOTICE,
  QUESTION_TEXT_MAX_LENGTH,
  QUESTION_TEXT_MIN_LENGTH,
  QUESTION_TITLE_MAX_LENGTH,
} from '@kampus/school-core/lib/questions.ts'
import { Button, Field, Select, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, Notice } from '../../ui/SchoolLayout.tsx'
import { createFieldCollector } from '../command-failure.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import {
  ASK_DONE_TEXT,
  EMPTY_ASK,
  askServerFailure,
  checkAsk,
  type AskErrors,
  type AskFailure,
} from '../student-question.ts'
import { useNotify } from '../toast.tsx'

type AssignmentRecord = State['assignments'][number]
type SubjectRecord = State['subjects'][number]
type TeacherRecord = State['teachers'][number]

/**
 * Yeni soru (alt pencere): ders, öğretmen (dersin tek öğretmeni varsa otomatik), isteğe bağlı kazanım,
 * konu başlığı ve soru metni. Seçenekler sunucunun kapsamladığı atamalardan kurulur (öğrenci yalnız
 * kendi sınıfının ders öğretmenlerine yazar, DOM-ILT-090). Düğme gönderimde kilitlenir; ağ hatasında
 * "Yeniden dene" aynı gövdeyi aynı `Idempotency-Key` ile gönderir (mükerrer soru oluşmaz). Başlık ve
 * metin yalnız bellekte durur, cihaza yazılmaz. Özel nitelikli bilgi uyarısı formda görünür
 * (DOM-ILT-014).
 */
export function QuestionAskSheet({ onClose }: { onClose: () => void }) {
  const assignments = useCollectionAll<AssignmentRecord>('assignments')
  const teachers = useCollectionAll<TeacherRecord>('teachers')
  const subjects = useCollectionAll<SubjectRecord>('subjects')
  const error = assignments.error ?? teachers.error ?? subjects.error
  const options = useMemo(
    () =>
      assignments.data && teachers.data && subjects.data
        ? askOptions(assignments.data, teachers.data, subjects.data)
        : undefined,
    [assignments.data, teachers.data, subjects.data],
  )
  if (options && options.length > 0) return <AskForm options={options} onClose={onClose} />
  return (
    <Sheet visible title="Yeni soru" onClose={onClose}>
      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            for (const query of [assignments, teachers, subjects])
              if (query.error) void query.refetch()
          }}
        />
      ) : !options ? (
        <ListLoading label="Dersler yükleniyor…" />
      ) : (
        <Notice
          title="Soru gönderilemiyor"
          text="Sınıfın için soru gönderebileceğin bir ders öğretmeni bulunamadı."
        />
      )}
    </Sheet>
  )
}

function AskForm({
  options,
  onClose,
}: {
  options: NonNullable<ReturnType<typeof askOptions>>
  onClose: () => void
}) {
  const notify = useNotify()
  const ask = useAskQuestion()
  const [values, setValues] = useState<AskValues>(EMPTY_ASK)
  const [errors, setErrors] = useState<AskErrors>({})
  const [failure, setFailure] = useState<AskFailure | null>(null)
  const option = optionOf(options, values.subjectId)
  const teacherId = teacherChoice(option, values.teacherId)
  const single = option?.teachers.length === 1 ? option.teachers[0] : undefined

  function change(patch: Partial<AskValues>, field: keyof AskErrors) {
    setValues({ ...values, ...patch })
    setErrors({ ...errors, [field]: undefined })
    setFailure(null)
  }

  async function submit() {
    if (ask.isPending) return
    const check = checkAsk({ ...values, teacherId }, options)
    if (!check.ok) {
      setErrors(check.errors)
      setFailure(null)
      return
    }
    setErrors({})
    setFailure(null)
    const collector = createFieldCollector()
    const outcome = await ask.submit(check.body, {
      setError: collector.setError,
      // Hata formun içinde gösterilir; toast aynı hatayı ikinci kez söylemesin.
      silent: () => true,
    })
    if (outcome.status === 'busy') return
    if (outcome.status === 'failed') {
      const next = askServerFailure(outcome.error, collector.fields)
      setErrors(next.errors)
      setFailure(next)
      return
    }
    notify(ASK_DONE_TEXT)
    onClose()
  }

  const retry = failure?.retryable === true
  const footer = (
    <View style={{ gap: 12 }}>
      {failure?.message && (
        <Notice tone="red" title="Soru gönderilemedi" text={failure.message}>
          {retry && <T size={13}>Soru iletilmiş olabilir; yeniden denemek mükerrer kayıt açmaz.</T>}
        </Notice>
      )}
      <Button
        primary
        icon="Send"
        disabled={ask.isPending}
        label={ask.isPending ? 'Soru gönderiliyor' : retry ? 'Yeniden dene' : 'Soruyu gönder'}
        onPress={() => void submit()}
      >
        {ask.isPending ? 'Gönderiliyor…' : retry ? 'Yeniden dene' : 'Soruyu gönder'}
      </Button>
    </View>
  )
  return (
    <Sheet visible title="Yeni soru" onClose={onClose} footer={footer} pinFooter>
      <Notice title="Hassas bilgi paylaşma" text={QUESTION_SENSITIVE_NOTICE} />
      <Select
        label="Ders"
        value={values.subjectId}
        options={options.map((item) => ({ value: item.subjectId, label: item.subject }))}
        required
        onChange={(subjectId) => change({ subjectId, teacherId: '', topic: '' }, 'subjectId')}
      />
      <T muted size={12}>
        Soru, sınıfında o dersi veren öğretmene gider.
      </T>
      {errors.subjectId && <FieldError text={errors.subjectId} />}
      {single ? (
        <DetailPair label="Öğretmen" value={single.name} />
      ) : (
        option && (
          <Select
            label="Öğretmen"
            value={teacherId}
            options={option.teachers.map((teacher) => ({ value: teacher.id, label: teacher.name }))}
            required
            onChange={(next) => change({ teacherId: next }, 'teacherId')}
          />
        )
      )}
      {errors.teacherId && <FieldError text={errors.teacherId} />}
      {option && option.topics.length > 0 && (
        <Select
          label="Kazanım (isteğe bağlı)"
          value={values.topic}
          options={option.topics.map((topic) => ({ value: topic, label: topic }))}
          onChange={(topic) => change({ topic }, 'topic')}
        />
      )}
      {errors.topic && <FieldError text={errors.topic} />}
      <Field
        label="Konu başlığı"
        value={values.title}
        onChange={(title) => change({ title }, 'title')}
        placeholder="Hangi konuda yardıma ihtiyacın var?"
        hint={`En çok ${QUESTION_TITLE_MAX_LENGTH} karakter.`}
        maxLength={QUESTION_TITLE_MAX_LENGTH}
        editable={!ask.isPending}
        {...(errors.title ? { error: errors.title } : {})}
      />
      <Field
        label="Sorun"
        value={values.text}
        onChange={(text) => change({ text }, 'text')}
        placeholder="Sorunu ve takıldığın noktayı açıkla…"
        hint={`En az ${QUESTION_TEXT_MIN_LENGTH}, en çok ${QUESTION_TEXT_MAX_LENGTH} karakter.`}
        multiline
        maxLength={QUESTION_TEXT_MAX_LENGTH}
        editable={!ask.isPending}
        {...(errors.text ? { error: errors.text } : {})}
      />
    </Sheet>
  )
}

function FieldError({ text }: { text: string }) {
  return <Notice tone="red" title={text} />
}
