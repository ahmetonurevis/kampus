import { useState } from 'react'
import { View } from 'react-native'
import { questionStamp, type QuestionRow } from '@kampus/react-shared/question-model.ts'
import { useWithdrawQuestion } from '@kampus/react-shared/use-question-commands.ts'
import { Badge, Button, Sheet, T, useColors } from '../../ui/components.tsx'
import { DetailPair, Notice, Section } from '../../ui/SchoolLayout.tsx'
import {
  PHOTO_NOTE,
  WITHDRAW_TEXTS,
  questionBadgeTone,
  withdrawFailure,
} from '../student-question.ts'
import { useNotify } from '../toast.tsx'

/**
 * Soru ayrıntısı (alt pencere): soru, yanıtlar ve yanıtlanmamış soruyu geri çekme. Satır listeden
 * gelir ve her yazmadan sonra sorgu tazelenir; geri çekme `If-Match` olarak okunan sürümü gönderir,
 * soru bu arada yanıtlandıysa (409) liste güncellenir ve Türkçe mesaj gösterilir. Yanıtı yazan yalnız
 * "Öğretmen" olarak görünür (DOM-ILT-092). Düğme gönderimde kilitlenir; ağ hatasında "Yeniden dene".
 */
export function QuestionSheet({ row, onClose }: { row: QuestionRow; onClose: () => void }) {
  return (
    <Sheet visible title="Soru ayrıntısı" onClose={onClose}>
      <T bold size={18}>
        {row.title}
      </T>
      <Badge text={row.status} tone={questionBadgeTone(row.state)} />
      <Section title="Bilgiler" panel>
        <View style={{ gap: 12 }}>
          <DetailPair label="Ders" value={row.subject} />
          <DetailPair label="Öğretmen" value={row.teacher} />
          <DetailPair label="Kazanım" value={row.topic || '—'} />
          <DetailPair label="Gönderim" value={questionStamp(row.createdAt)} />
        </View>
      </Section>
      <Section title="Soru" panel>
        <T selectable>{row.text}</T>
        {row.fileIds.length > 0 && (
          <T muted size={13}>
            {PHOTO_NOTE}
          </T>
        )}
      </Section>
      <Answers row={row} />
      <WithdrawSection row={row} onDone={onClose} />
    </Sheet>
  )
}

function Answers({ row }: { row: QuestionRow }) {
  const c = useColors()
  return (
    <Section title="Yanıtlar" panel>
      {row.answers.length === 0 ? (
        <T muted size={14}>
          {row.state === 'withdrawn' ? 'Soru geri çekildi.' : 'Henüz yanıt yok.'}
        </T>
      ) : (
        <View style={{ gap: 12 }} accessibilityRole="list">
          {row.answers.map((entry) => (
            <View
              key={entry.id}
              style={{
                gap: 4,
                padding: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: c.border,
              }}
            >
              <T muted size={12}>
                {entry.kind === 'first' ? 'Yanıt' : 'Ek yanıt'} · {entry.by} ·{' '}
                {questionStamp(entry.at)}
              </T>
              <T selectable>{entry.text}</T>
            </View>
          ))}
        </View>
      )}
    </Section>
  )
}

/** Yanıtsız soruyu geri çekme: önce onay sorulur (geri alınamaz); `If-Match` okunan sürümdür. */
function WithdrawSection({ row, onDone }: { row: QuestionRow; onDone: () => void }) {
  const notify = useNotify()
  const withdraw = useWithdrawQuestion()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ReturnType<typeof withdrawFailure> | null>(null)

  async function confirm() {
    if (withdraw.isPending) return
    setFailure(null)
    const outcome = await withdraw.submit(
      { questionId: row.id, version: row.version },
      { silent: () => true },
    )
    if (outcome.status === 'busy') return
    if (outcome.status === 'failed') {
      // Çakışmada (soru yanıtlandı) liste kendiliğinden tazelenir; onay kapanır, mesaj kalır.
      if (!outcome.error.isNetworkError && outcome.error.status < 500) setConfirming(false)
      setFailure(withdrawFailure(outcome.error))
      return
    }
    notify(WITHDRAW_TEXTS.done)
    onDone()
  }

  return (
    <>
      {failure?.message && (
        <Notice tone="red" title="Soru geri çekilemedi" text={failure.message}>
          {failure.retryable && (
            <T size={13}>İşlem tamamlanmış olabilir; yeniden denemek güvenlidir.</T>
          )}
        </Notice>
      )}
      {row.canWithdraw && (
        <Section title="Soruyu geri çek" panel>
          <T muted size={14}>
            Yanıtlanmamış sorunu geri çekebilirsin. Soru silinmez; öğretmenin bekleyen sorularından
            çıkar.
          </T>
          {confirming ? (
            <Notice title={WITHDRAW_TEXTS.title} text={WITHDRAW_TEXTS.description} tone="amber">
              <Button
                danger
                icon="ArrowLeft"
                disabled={withdraw.isPending}
                label={withdraw.isPending ? 'Soru geri çekiliyor' : WITHDRAW_TEXTS.confirm}
                onPress={() => void confirm()}
              >
                {withdraw.isPending
                  ? 'Geri çekiliyor…'
                  : failure?.retryable
                    ? 'Yeniden dene'
                    : WITHDRAW_TEXTS.confirm}
              </Button>
              <Button disabled={withdraw.isPending} onPress={() => setConfirming(false)}>
                {WITHDRAW_TEXTS.cancel}
              </Button>
            </Notice>
          ) : (
            <Button icon="ArrowLeft" onPress={() => setConfirming(true)}>
              Soruyu geri çek
            </Button>
          )}
        </Section>
      )}
    </>
  )
}
