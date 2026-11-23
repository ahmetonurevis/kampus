import { Pressable, View } from 'react-native'
import { OPTION_LETTERS } from '@kampus/react-shared/quizzes.ts'
import { splitGapStem, type AttemptQuestion } from '@kampus/react-shared/attempt-model.ts'
import type { TaskAttemptAnswers } from '@kampus/react-shared/use-task-attempts.ts'
import { Button, Field, IconButton, Select, T, useColors } from '../../ui/components.tsx'
import { chooseMatch, moveOrderItem, setGapValue, shownOrder } from '../student-quiz-task.ts'

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

/** Seçenek satırı: tek seçimli gruplarda dokunma hedefi en az 48 dp (burada 56). */
function Choice({
  label,
  prefix,
  checked,
  disabled,
  onPress,
}: {
  label: string
  prefix?: string
  checked: boolean
  disabled: boolean
  onPress: () => void
}) {
  const c = useColors()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={prefix ? `${prefix}) ${label}` : label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: checked ? 2 : 1,
        borderColor: checked ? c.primary : c.border,
        backgroundColor: checked ? c.primarySoft : c.surface,
        opacity: disabled ? 0.6 : pressed ? 0.75 : 1,
      })}
    >
      {!!prefix && (
        <T bold size={15} muted>
          {prefix})
        </T>
      )}
      <T size={15} style={{ flex: 1, flexShrink: 1 }}>
        {label}
      </T>
    </Pressable>
  )
}

const Stem = ({ text }: { text: string }) => (
  <T bold size={17} accessibilityRole="header">
    {text}
  </T>
)

/**
 * Tek sorunun cevap girişi (web `QuestionInput`; DOM-BEC-042). Soru gövdesi anahtarsızdır, cevap
 * çekirdeğin cevap biçimindedir. Seçimler radyo grubu, eşleştirme ve seçenekli boşluk seçim
 * penceresi, sıralama yukarı/aşağı düğmeleri, kısa cevap metin alanıdır; her hedef en az 48 dp.
 */
export function TaskQuestionInput({ question, response, onChange, disabled = false }: Props) {
  const body = question.question
  switch (body.questionType) {
    case 'multiple_choice': {
      const chosen = response?.questionType === 'multiple_choice' ? response.optionId : null
      return (
        <View style={{ gap: 12 }}>
          <Stem text={body.stem} />
          <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
            {body.options.map((option, index) => (
              <Choice
                key={option.id}
                prefix={OPTION_LETTERS[index] ?? String(index + 1)}
                label={option.text}
                checked={chosen === option.id}
                disabled={disabled}
                onPress={() => onChange({ questionType: 'multiple_choice', optionId: option.id })}
              />
            ))}
          </View>
        </View>
      )
    }
    case 'true_false': {
      const chosen = response?.questionType === 'true_false' ? response.answer : null
      const options = body.allowNotGiven
        ? [...TRUE_FALSE, { value: 'not_given', label: 'Verilmemiş' } as const]
        : TRUE_FALSE
      return (
        <View style={{ gap: 12 }}>
          <Stem text={body.stem} />
          <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
            {options.map((option) => (
              <Choice
                key={option.value}
                label={option.label}
                checked={chosen === option.value}
                disabled={disabled}
                onPress={() => onChange({ questionType: 'true_false', answer: option.value })}
              />
            ))}
          </View>
        </View>
      )
    }
    case 'matching': {
      const pairs = response?.questionType === 'matching' ? response.pairs : []
      const options = body.choices.map((choice) => ({ value: choice.id, label: choice.text }))
      return (
        <View style={{ gap: 12 }}>
          <Stem text={body.stem} />
          {body.prompts.map((prompt) => (
            <View key={prompt.id}>
              <Select
                disabled={disabled}
                label={prompt.text}
                value={pairs.find((pair) => pair.promptId === prompt.id)?.choiceId}
                options={options}
                onChange={(choiceId) => onChange(chooseMatch(response, prompt.id, choiceId))}
              />
            </View>
          ))}
        </View>
      )
    }
    case 'gap_fill': {
      const gaps = response?.questionType === 'gap_fill' ? response.gaps : []
      const number = (id: string) => body.gaps.findIndex((gap) => gap.id === id) + 1
      const shown = splitGapStem(body.stem)
        .map((part) => (part.kind === 'text' ? part.text : `(${number(part.id)}) ____`))
        .join('')
      return (
        <View style={{ gap: 12 }}>
          <T bold size={17} accessibilityRole="header">
            {shown}
          </T>
          {body.gaps.map((gap, index) => {
            const options = Array.isArray(gap.options) ? (gap.options as string[]) : []
            const value = gaps.find((item) => item.gapId === gap.id)?.value ?? ''
            const label = `${index + 1}. boşluk`
            return options.length > 0 ? (
              <View key={gap.id}>
                <Select
                  disabled={disabled}
                  label={label}
                  value={value}
                  options={options.map((option) => ({ value: option, label: option }))}
                  onChange={(next) => onChange(setGapValue(response, gap.id, next))}
                />
              </View>
            ) : (
              <Field
                key={gap.id}
                label={label}
                value={value}
                maxLength={200}
                editable={!disabled}
                onChange={(next) => onChange(setGapValue(response, gap.id, next))}
              />
            )
          })}
        </View>
      )
    }
    case 'ordering': {
      const shown = shownOrder(body.items, response)
      const textOf = (id: string) => body.items.find((item) => item.id === id)?.text ?? ''
      const move = (index: number, delta: -1 | 1) => {
        const next = moveOrderItem(shown, index, delta)
        if (next) onChange(next)
      }
      return (
        <View style={{ gap: 12 }}>
          <Stem text={body.stem} />
          <T muted size={14}>
            Öğeleri doğru sıraya getir. Sıra değişince cevabın kaydedilir.
          </T>
          <View accessibilityRole="list" style={{ gap: 8 }}>
            {shown.map((id, index) => (
              <OrderRow
                key={id}
                index={index}
                text={textOf(id)}
                first={index === 0}
                last={index === shown.length - 1}
                disabled={disabled}
                onMove={(delta) => move(index, delta)}
              />
            ))}
          </View>
          {response?.questionType !== 'ordering' && (
            <Button
              icon="Check"
              disabled={disabled}
              onPress={() => onChange({ questionType: 'ordering', order: shown })}
            >
              Bu sırayı cevap olarak kaydet
            </Button>
          )}
        </View>
      )
    }
    case 'short_answer': {
      const value = response?.questionType === 'short_answer' ? response.value : ''
      return (
        <View style={{ gap: 12 }}>
          <Stem text={body.stem} />
          <Field
            label="Cevabın"
            value={value}
            maxLength={Math.min(body.maxLength, 500)}
            editable={!disabled}
            onChange={(next) => onChange({ questionType: 'short_answer', value: next })}
          />
        </View>
      )
    }
    default:
      return body satisfies never
  }
}

function OrderRow({
  index,
  text,
  first,
  last,
  disabled,
  onMove,
}: {
  index: number
  text: string
  first: boolean
  last: boolean
  disabled: boolean
  onMove: (delta: -1 | 1) => void
}) {
  const c = useColors()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 56,
        paddingLeft: 14,
        paddingRight: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
      }}
    >
      <T bold size={15} muted>
        {index + 1}.
      </T>
      <T size={15} style={{ flex: 1, flexShrink: 1 }}>
        {text}
      </T>
      <IconButton
        name="ChevronUp"
        label={`${text} öğesini yukarı taşı`}
        disabled={disabled || first}
        onPress={() => onMove(-1)}
      />
      <IconButton
        name="ChevronDown"
        label={`${text} öğesini aşağı taşı`}
        disabled={disabled || last}
        onPress={() => onMove(1)}
      />
    </View>
  )
}
