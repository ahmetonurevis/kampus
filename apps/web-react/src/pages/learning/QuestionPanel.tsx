import { useState } from 'react'
import { QUESTION_ANSWER_LIMIT } from '@kampus/school-core/lib/questions.ts'
import { useWithdrawQuestion } from '@kampus/react-shared/use-question-commands.ts'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { notify } from '@/lib/notify.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { QuestionAnswerForm } from './QuestionAnswerForm.tsx'
import { SubmissionFileList } from './SubmissionFiles.tsx'
import {
  questionRow,
  questionStamp,
  type QuestionLookups,
  type QuestionRow,
} from './question-rows.ts'

export type QuestionAudience = 'student' | 'teacher'

type Props = {
  questionId: string
  onClose: () => void
  audience: QuestionAudience
  /** Ders ve öğretmen adları; hazır olana kadar `undefined`. */
  lookups: QuestionLookups | undefined
}

const STATE_TONES = {
  pending: 'amber',
  answered: 'green',
  withdrawn: 'gray',
} as const satisfies Record<QuestionRow['state'], BadgeTone>

/**
 * Soru ayrıntısı: tek kayıt ucundan okunur; kapsam dışı soru (başka öğrencinin ya da başka
 * öğretmenin sorusu) 404 ile "bulunamadı" olur. Yanıtlar ve ek yanıtlar kronolojik listelenir;
 * verilmiş yanıt değişmez, düzenleme düğmesi yoktur (DOM-ILT-092). Soru fotoğrafları kullanıcı
 * "Aç" dediğinde kısa ömürlü imzalı bağlantıyla açılır; her bağlantı denetimdir (DOM-ILT-094). Öğrencide yanıtsız soru geri
 * çekilebilir (DOM-ILT-091), öğretmende yanıt veya ek yanıt formu bulunur.
 */
export function QuestionPanel({ questionId, onClose, audience, lookups }: Props) {
  return (
    <SidePanel
      open={questionId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Soru ayrıntısı"
    >
      {questionId ? (
        <QuestionDetail questionId={questionId} audience={audience} lookups={lookups} />
      ) : null}
    </SidePanel>
  )
}

function QuestionDetail({
  questionId,
  audience,
  lookups,
}: {
  questionId: string
  audience: QuestionAudience
  lookups: QuestionLookups | undefined
}) {
  const item = useCoreItem('questions', questionId)
  const now = useMinuteClock()
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data || !lookups) return <SummaryLoading />
  const row = questionRow(item.data, lookups, now)
  const teacher = audience === 'teacher'
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="MessageCircleQuestion" />}
        title={row.title}
        subtitle={[teacher ? row.student : row.teacher, questionStamp(row.createdAt)]
          .filter(Boolean)
          .join(' · ')}
        status={row.status}
        tone={STATE_TONES[row.state]}
      />
      <SummaryMetrics
        items={[
          { label: 'Ders', value: row.subject },
          teacher
            ? { label: 'Öğrenci', value: row.student || '—' }
            : { label: 'Öğretmen', value: row.teacher },
          { label: 'Kazanım', value: row.topic || '—' },
          { label: 'Yanıt süresi', value: row.response },
        ]}
      />
      <SummarySection title="Soru">
        <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">{row.text}</p>
      </SummarySection>
      {row.fileIds.length > 0 ? (
        <SummarySection title="Fotoğraflar">
          <SubmissionFileList fileIds={row.fileIds} label="Soru fotoğrafları" />
        </SummarySection>
      ) : null}
      <SummarySection title="Yanıtlar">
        {row.answers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {row.state === 'withdrawn' ? 'Soru geri çekildi.' : 'Henüz yanıt yok.'}
          </p>
        ) : (
          <ol className="grid gap-3">
            {row.answers.map((entry) => (
              <li key={entry.id} className="rounded-card border bg-surface-soft px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  {entry.kind === 'first' ? 'Yanıt' : 'Ek yanıt'} · {entry.by} ·{' '}
                  {questionStamp(entry.at)}
                </p>
                <p className="mt-1 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {entry.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </SummarySection>
      {teacher ? (
        <AnswerSection
          row={row}
          reload={async () => {
            const fresh = (await item.refetch()).data
            return fresh ? questionRow(fresh, lookups, new Date().toISOString()) : null
          }}
        />
      ) : row.canWithdraw ? (
        <SummarySection title="Soruyu geri çek">
          <WithdrawAction row={row} />
        </SummarySection>
      ) : null}
    </>
  )
}

function AnswerSection({
  row,
  reload,
}: {
  row: QuestionRow
  reload: () => Promise<QuestionRow | null>
}) {
  if (row.state === 'withdrawn')
    return (
      <SummarySection title="Yanıt">
        <p role="status" className="text-sm text-muted-foreground">
          Öğrenci bu soruyu geri çekti; yanıt yazılamaz.
        </p>
      </SummarySection>
    )
  if (row.answerLimitReached)
    return (
      <SummarySection title="Ek yanıt">
        <p role="status" className="text-sm text-muted-foreground">
          Bu soruya en fazla {QUESTION_ANSWER_LIMIT} yanıt yazılabilir; sınıra ulaşıldı.
        </p>
      </SummarySection>
    )
  // Bölüm başlığı formun kendisindedir: başlık, etiket ve düğme formun tuttuğu kayıttan türer.
  return <QuestionAnswerForm key={row.id} row={row} reload={reload} />
}

/** Yanıtsız soruyu geri çekme: onay sorulur; `If-Match` okunan sürümdür (DOM-ILT-091). */
function WithdrawAction({ row }: { row: QuestionRow }) {
  const [confirming, setConfirming] = useState(false)
  const withdraw = useWithdrawQuestion()
  const busy = withdraw.isPending

  async function confirm() {
    const outcome = await withdraw.submit({ questionId: row.id, version: row.version })
    if (outcome.status === 'success') notify.success('Soru geri çekildi.')
    // Başarısızlıkta toast nedeni söyler; soru yeniden okunur, panel güncel hâliyle kalır.
    if (outcome.status !== 'busy') setConfirming(false)
  }

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        Yanıtlanmamış sorunuzu geri çekebilirsiniz. Soru silinmez; öğretmenin bekleyen sorularından
        çıkar.
      </p>
      <Button variant="outline" onClick={() => setConfirming(true)}>
        <Icon name="Undo2" size={16} aria-hidden="true" />
        Soruyu geri çek
      </Button>
      <Modal
        open={confirming}
        onOpenChange={(open) => (open || busy ? undefined : setConfirming(false))}
        title="Soruyu geri çek"
        description="Soru yanıtlanmadan geri çekilirse öğretmen onu yanıtlayamaz. Bu işlem geri alınamaz."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirm()}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              Evet, geri çek
            </Button>
          </>
        }
      >
        <p className="text-sm [overflow-wrap:anywhere]">{row.title}</p>
      </Modal>
    </>
  )
}
