import { useId } from 'react'
import type { TaskAttemptAnswers } from '@kampus/react-shared/use-task-attempts.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { splitGapStem, type AttemptQuestion } from './student-task-model.ts'

type Response = TaskAttemptAnswers[string]

type Props = {
  question: AttemptQuestion
  response: Response | undefined
  onChange: (response: Response) => void
  disabled?: boolean
}

const TRUE_FALSE = [
  { value: 'true', label: 'Doğru' },
  { value: 'false', label: 'Yanlış' },
] as const

/** İngilizce içerik `lang="en"` ile işaretlenir; arayüz metni Türkçe kalır. */
const Stem = ({ text }: { text: string }) => (
  <p lang="en" className="text-lg font-medium [overflow-wrap:anywhere] whitespace-pre-line">
    {text}
  </p>
)

/**
 * Tek sorunun cevap girişi. Soru gövdesi anahtarsızdır (sunucu doğru cevabı göndermez); cevap
 * çekirdeğin `responseSchema` biçimindedir. Her tür klavye ve ekran okuyucuyla kullanılabilir:
 * seçimler radyo grubu, eşleştirme ve boşluk listesi yerel seçim, sıralama yukarı/aşağı düğmeleri.
 */
export function QuestionInput({ question, response, onChange, disabled = false }: Props) {
  const body = question.question
  const groupId = useId()

  switch (body.questionType) {
    case 'multiple_choice': {
      const chosen = response?.questionType === 'multiple_choice' ? response.optionId : null
      return (
        <fieldset className="grid gap-3" disabled={disabled}>
          <legend className="mb-1">
            <Stem text={body.stem} />
          </legend>
          {body.options.map((option, index) => (
            <label
              key={option.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-card border px-4 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <input
                type="radio"
                name={groupId}
                value={option.id}
                checked={chosen === option.id}
                onChange={() => onChange({ questionType: 'multiple_choice', optionId: option.id })}
                className="size-5 accent-primary"
              />
              <span className="text-sm font-semibold text-muted-foreground" aria-hidden="true">
                {String.fromCharCode(65 + index)}
              </span>
              <span lang="en" className="[overflow-wrap:anywhere]">
                {option.text}
              </span>
            </label>
          ))}
        </fieldset>
      )
    }
    case 'true_false': {
      const chosen = response?.questionType === 'true_false' ? response.answer : null
      const options = body.allowNotGiven
        ? [...TRUE_FALSE, { value: 'not_given', label: 'Verilmemiş' } as const]
        : TRUE_FALSE
      return (
        <fieldset className="grid gap-3" disabled={disabled}>
          <legend className="mb-1">
            <Stem text={body.stem} />
          </legend>
          {options.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-card border px-4 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <input
                type="radio"
                name={groupId}
                value={option.value}
                checked={chosen === option.value}
                onChange={() => onChange({ questionType: 'true_false', answer: option.value })}
                className="size-5 accent-primary"
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      )
    }
    case 'matching': {
      const pairs = response?.questionType === 'matching' ? response.pairs : []
      const choose = (promptId: string, choiceId: string) => {
        const rest = pairs.filter((pair) => pair.promptId !== promptId)
        onChange({
          questionType: 'matching',
          pairs: choiceId === '' ? rest : [...rest, { promptId, choiceId }],
        })
      }
      return (
        <fieldset className="grid gap-3" disabled={disabled}>
          <legend className="mb-1">
            <Stem text={body.stem} />
          </legend>
          {body.prompts.map((prompt) => (
            <div
              key={prompt.id}
              className="grid items-center gap-2 sm:grid-cols-[1fr_minmax(180px,1fr)]"
            >
              <label
                htmlFor={`${groupId}-${prompt.id}`}
                lang="en"
                className="[overflow-wrap:anywhere]"
              >
                {prompt.text}
              </label>
              <NativeSelect
                id={`${groupId}-${prompt.id}`}
                className="w-full"
                value={pairs.find((pair) => pair.promptId === prompt.id)?.choiceId ?? ''}
                onChange={(event) => choose(prompt.id, event.target.value)}
              >
                <NativeSelectOption value="">Seçin</NativeSelectOption>
                {body.choices.map((choice) => (
                  <NativeSelectOption key={choice.id} value={choice.id} lang="en">
                    {choice.text}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          ))}
        </fieldset>
      )
    }
    case 'gap_fill': {
      const gaps = response?.questionType === 'gap_fill' ? response.gaps : []
      const setGap = (gapId: string, value: string) =>
        onChange({
          questionType: 'gap_fill',
          gaps: [...gaps.filter((gap) => gap.gapId !== gapId), { gapId, value }],
        })
      return (
        <fieldset className="grid gap-3" disabled={disabled}>
          <legend className="sr-only">Boşlukları doldurun</legend>
          <p lang="en" className="text-lg leading-10 font-medium [overflow-wrap:anywhere]">
            {splitGapStem(body.stem).map((part) => {
              if (part.kind === 'text') return <span key={part.key}>{part.text}</span>
              const gap = body.gaps.find((item) => item.id === part.id)
              const options = Array.isArray(gap?.options) ? (gap.options as string[]) : []
              const value = gaps.find((item) => item.gapId === part.id)?.value ?? ''
              const label = `${body.gaps.findIndex((item) => item.id === part.id) + 1}. boşluk`
              return options.length > 0 ? (
                <NativeSelect
                  key={part.key}
                  aria-label={label}
                  className="mx-1 inline-block w-auto min-w-32 align-middle"
                  value={value}
                  onChange={(event) => setGap(part.id, event.target.value)}
                >
                  <NativeSelectOption value="">Seçin</NativeSelectOption>
                  {options.map((option) => (
                    <NativeSelectOption key={option} value={option}>
                      {option}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  key={part.key}
                  aria-label={label}
                  value={value}
                  maxLength={200}
                  autoComplete="off"
                  onChange={(event) => setGap(part.id, event.target.value)}
                  className="mx-1 inline-block h-9 w-40 align-middle"
                />
              )
            })}
          </p>
        </fieldset>
      )
    }
    case 'ordering': {
      const chosen = response?.questionType === 'ordering' ? response.order : []
      const shown = chosen.length === body.items.length ? chosen : body.items.map((item) => item.id)
      const textOf = (id: string) => body.items.find((item) => item.id === id)?.text ?? ''
      const move = (index: number, delta: -1 | 1) => {
        const next = [...shown]
        const target = index + delta
        const [moved] = next.splice(index, 1)
        if (moved === undefined || target < 0 || target > shown.length - 1) return
        next.splice(target, 0, moved)
        onChange({ questionType: 'ordering', order: next })
      }
      return (
        <fieldset className="grid gap-3" disabled={disabled}>
          <legend className="mb-1">
            <Stem text={body.stem} />
          </legend>
          <p className="text-sm text-muted-foreground">
            Öğeleri doğru sıraya getirin. Sıra değişince cevabınız kaydedilir.
          </p>
          <ol className="grid gap-2">
            {shown.map((id, index) => (
              <li key={id} className="flex items-center gap-2 rounded-card border px-3 py-2">
                <span className="w-6 text-sm font-semibold text-muted-foreground">
                  {index + 1}.
                </span>
                <span lang="en" className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {textOf(id)}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label={`${textOf(id)} öğesini yukarı taşı`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <Icon name="ArrowUp" size={16} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label={`${textOf(id)} öğesini aşağı taşı`}
                  disabled={disabled || index === shown.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <Icon name="ArrowDown" size={16} aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ol>
          {chosen.length === 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="justify-self-start"
              disabled={disabled}
              onClick={() => onChange({ questionType: 'ordering', order: shown })}
            >
              Bu sırayı cevap olarak kaydet
            </Button>
          ) : null}
        </fieldset>
      )
    }
    case 'short_answer': {
      const value = response?.questionType === 'short_answer' ? response.value : ''
      return (
        <div className="grid gap-3">
          <label htmlFor={`${groupId}-kisa`}>
            <Stem text={body.stem} />
          </label>
          <Input
            id={`${groupId}-kisa`}
            value={value}
            maxLength={Math.min(body.maxLength, 500)}
            autoComplete="off"
            disabled={disabled}
            onChange={(event) =>
              onChange({ questionType: 'short_answer', value: event.target.value })
            }
          />
        </div>
      )
    }
    default:
      return body satisfies never
  }
}
