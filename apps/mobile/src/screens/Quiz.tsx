import { useEffect, useRef, useState } from 'react'
import { ScrollView, View, Pressable } from 'react-native'
import { usePreventRemove, type NavigationAction } from '@react-navigation/native'
import { gradeQuiz } from '@kampus/school-core/lib/domain.ts'
import { useActiveSchool } from '../store/SchoolProvider.tsx'
import { context } from '../model/school.ts'
import type { ScreenProps } from '../route-types.ts'
import { Button, Card, Heading, Icon, Sheet, T, styles, useColors } from '../ui/components.tsx'

export default function Quiz({ route, navigation }: ScreenProps<'Quiz'>) {
  const { data, session, commit, busy } = useActiveSchool(),
    c = useColors(),
    scope = context(data, session)
  const quiz = data.quizzes.find((q) => q.id === route.params.row.id)
  if (!quiz) throw new Error('Quiz kaydı bulunamadı.')
  const [answers, setAnswers] = useState<Record<string, number>>({}),
    [index, setIndex] = useState(0),
    [remaining, setRemaining] = useState(quiz.duration * 60),
    [result, setResult] = useState<ReturnType<typeof gradeQuiz> | null>(null),
    [exit, setExit] = useState<NavigationAction | null>(null),
    [allowExit, setAllowExit] = useState(false)
  const deadline = useRef(Date.now() + quiz.duration * 60000),
    submitting = useRef(false)
  useEffect(() => {
    if (result) return
    const timer = setInterval(
      () => setRemaining(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))),
      1000,
    )
    return () => clearInterval(timer)
  }, [result])
  usePreventRemove(!allowExit && !result && Object.keys(answers).length > 0, ({ data }) =>
    setExit(data.action),
  )
  useEffect(() => {
    if (allowExit && exit) navigation.dispatch(exit)
  }, [allowExit, exit, navigation])
  const questions = quiz.questionIds.map((id) => {
    const found = data.bank.find((q) => q.id === id)
    if (!found) throw new Error('Sınav soruları bulunamadı.')
    return found
  })
  const question = questions[index]
  const finish = async () => {
    if (submitting.current) return
    submitting.current = true
    const outcome: { score: ReturnType<typeof gradeQuiz> | null } = { score: null }
    const ok = await commit((s, id) => {
      const score = gradeQuiz(quiz, s.bank, answers, remaining === 0)
      outcome.score = score
      const date = new Date().toISOString()
      s.quizAttempts.push({
        id: id('attempt'),
        quizId: quiz.id,
        studentId: scope.student.id,
        answers,
        ...score,
        date,
      })
      s.grades.push({
        id: id('grade'),
        studentId: scope.student.id,
        subjectId: quiz.subjectId,
        subject: quiz.subject,
        title: quiz.title,
        topic: 'Kazanım testi',
        score: score.score,
        date,
      })
    }, 'Quiz sonucu kaydedildi.')
    if (ok && outcome.score) setResult(outcome.score)
    submitting.current = false
  }
  useEffect(() => {
    if (remaining === 0 && !result && !submitting.current) void finish()
  }, [remaining])
  if (!question) throw new Error('Sınav soruları bulunamadı.')
  return (
    <>
      <ScrollView contentContainerStyle={styles.page}>
        <Heading
          title={quiz.title}
          subtitle={result ? 'Çalışmanı tamamladın.' : `${quiz.subject} · Kazanım testi`}
        />
        {result ? (
          <>
            <Card soft style={{ backgroundColor: c.hero, padding: 24, alignItems: 'center' }}>
              <Icon name="Award" size={34} color={c.heroMuted} />
              <T size={14} style={{ color: c.heroMuted }}>
                Sonucun kaydedildi
              </T>
              <T bold size={40} style={{ color: c.heroText }}>
                {result.score} / 100
              </T>
              <T style={{ color: c.heroMuted }}>
                {result.correct} doğru · {result.total - result.correct} yanlış / boş
              </T>
            </Card>
            {questions.map((q) => {
              const given = answers[q.id]
              return (
                <Card key={q.id}>
                  <T bold>{q.text}</T>
                  <T>
                    Cevabın:{' '}
                    {(given === undefined ? undefined : q.options[given]) || 'Boş bırakıldı'}
                  </T>
                  <T>Doğru cevap: {q.options[q.answer]}</T>
                  <T muted>{q.explanation}</T>
                </Card>
              )
            })}
            <Button primary onPress={() => navigation.goBack()}>
              Quiz listesine dön
            </Button>
          </>
        ) : (
          <>
            <View style={{ gap: 14 }}>
              <View style={styles.between}>
                <T bold size={14}>
                  Soru {index + 1} / {questions.length}
                </T>
                <View
                  style={[
                    styles.row,
                    {
                      backgroundColor: remaining < 60 ? c.redSoft : c.soft,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 20,
                      gap: 6,
                    },
                  ]}
                >
                  <Icon name="Clock3" size={16} color={remaining < 60 ? c.red : c.primary} />
                  <T bold size={13} style={{ color: remaining < 60 ? c.red : c.primary }}>
                    {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} kaldı
                  </T>
                </View>
              </View>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel="Yanıtlanan sorular"
                accessibilityValue={{
                  min: 0,
                  max: questions.length,
                  now: Object.keys(answers).length,
                }}
                style={{ height: 5, backgroundColor: c.soft, borderRadius: 3 }}
              >
                <View
                  style={{
                    width: `${(Object.keys(answers).length / questions.length) * 100}%`,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: c.primary,
                  }}
                />
              </View>
            </View>
            <Card soft style={{ padding: 22, gap: 14 }}>
              <T muted size={12}>
                {question.topic}
              </T>
              <T bold size={19}>
                {question.text}
              </T>
            </Card>
            {question.options.map((option, i) => (
              <Pressable
                key={i}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: answers[question.id] === i,
                  disabled: remaining === 0,
                }}
                disabled={remaining === 0}
                onPress={() => setAnswers((a) => ({ ...a, [question.id]: i }))}
                style={{
                  backgroundColor: answers[question.id] === i ? c.primarySoft : c.surface,
                  borderWidth: 1,
                  borderColor: answers[question.id] === i ? c.primary : c.border,
                  borderRadius: 18,
                  padding: 14,
                  minHeight: 56,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 11,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: answers[question.id] === i ? c.primary : c.soft,
                  }}
                >
                  <T
                    bold
                    size={13}
                    style={{ color: answers[question.id] === i ? c.onPrimary : c.muted }}
                  >
                    {String.fromCharCode(65 + i)}
                  </T>
                </View>
                <T style={{ flex: 1 }}>{option}</T>
              </Pressable>
            ))}
            <View style={styles.between}>
              <Button disabled={index === 0} onPress={() => setIndex(index - 1)}>
                Önceki
              </Button>
              <Button disabled={index === questions.length - 1} onPress={() => setIndex(index + 1)}>
                Sonraki
              </Button>
            </View>
            <T muted>{Object.keys(answers).length} soru yanıtlandı.</T>
            <Button
              primary
              disabled={busy || (remaining > 0 && Object.keys(answers).length < questions.length)}
              onPress={finish}
            >
              Sınavı bitir
            </Button>
          </>
        )}
      </ScrollView>
      {exit && (
        <Sheet visible title="Quizden ayrıl" onClose={() => setExit(null)}>
          <T>Henüz gönderilmemiş yanıtların kaydedilmeyecek. Ayrılmak istiyor musun?</T>
          <Button
            danger
            onPress={() => {
              setAllowExit(true)
            }}
          >
            Ayrıl
          </Button>
          <Button onPress={() => setExit(null)}>Çözmeye devam et</Button>
        </Sheet>
      )}
    </>
  )
}
