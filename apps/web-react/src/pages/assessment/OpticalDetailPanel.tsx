import { useMemo } from 'react'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import type { EvaluationRow, QuestionDetailRow, TopicRow } from './optical-model.ts'

type Props = {
  /** URL'deki değerlendirme kimliği (`?degerlendirme=`); boşsa panel kapalı. */
  selectedId: string
  row: EvaluationRow | undefined
  pending: boolean
  /** Okuma hatası; varsa "bulunamadı" yerine hata ve yeniden deneme gösterilir. */
  error?: unknown
  onRetry?: () => void
  onClose: () => void
}

const OUTCOME_TONES = { Doğru: 'green', Yanlış: 'red', 'Çoklu işaret': 'red' } as const
const TOPIC_COLUMNS = ['topic', 'percent']
const QUESTION_COLUMNS = ['number', 'outcome']

/**
 * Kayıtlı optik değerlendirmenin ayrıntısı (sağ panel, salt okunur): özet, kazanım başarıları ve soru
 * sonuçları. Veri kayıtlı analizden gelir; kapsam sunucudadır (öğretmen yalnız kendi branşını, öğrenci
 * ve veli yalnız bağlı öğrenciyi alır), istemci ek gizleme yapmaz. Eski analiz durumu açıkça yazılır.
 */
export function OpticalDetailPanel({ selectedId, row, pending, error, onRetry, onClose }: Props) {
  const title = row
    ? `${row.student} · ${row.subject}`
    : pending
      ? 'Analiz yükleniyor'
      : error
        ? 'Analiz yüklenemedi'
        : 'Analiz bulunamadı'
  return (
    <SidePanel
      open={Boolean(selectedId)}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description={row ? row.exam : undefined}
    >
      {row ? (
        <DetailBody key={row.id} row={row} />
      ) : pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Analiz yükleniyor…
        </p>
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Değerlendirme mevcut rol kapsamında bulunamadı. Listeye dönüp yeniden seçin.
        </p>
      )}
    </SidePanel>
  )
}

function DetailBody({ row }: { row: EvaluationRow }) {
  const topicColumns = useMemo<DataColumn<TopicRow>[]>(
    () => [
      {
        key: 'topic',
        label: 'Kazanım',
        cell: (item) => (
          <div className="grid gap-1">
            <span>{item.topic}</span>
            {item.weak ? <StatusBadge text="Zayıf" tone="amber" /> : null}
          </div>
        ),
      },
      { key: 'correct', label: 'Doğru' },
      { key: 'wrong', label: 'Yanlış' },
      { key: 'blank', label: 'Boş' },
      { key: 'total', label: 'Soru' },
      {
        key: 'percent',
        label: 'Başarı',
        cell: (item) => (item.total ? item.percent : 'Tüm sorular iptal'),
      },
    ],
    [],
  )
  const questionColumns = useMemo<DataColumn<QuestionDetailRow>[]>(
    () => [
      { key: 'number', label: 'Soru' },
      { key: 'topic', label: 'Kazanım' },
      { key: 'response', label: 'İşaret' },
      { key: 'answer', label: 'Anahtar' },
      {
        key: 'outcome',
        label: 'Sonuç',
        cell: (item) => (
          <StatusBadge
            text={item.outcome}
            tone={OUTCOME_TONES[item.outcome as keyof typeof OUTCOME_TONES] ?? 'gray'}
          />
        ),
      },
    ],
    [],
  )

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        {row.current ? (
          <div>
            <StatusBadge text="Güncel" tone="green" />
          </div>
        ) : (
          <div role="status" className="grid gap-1">
            <div>
              <StatusBadge text="Eski analiz" tone="amber" />
            </div>
            <p className="text-sm text-muted-foreground">
              {row.staleReason} Etüt planlamasında kullanılmaz.
            </p>
          </div>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Öğrenci</dt>
        <dd>{row.student}</dd>
        <dt className="text-muted-foreground">Deneme</dt>
        <dd>{row.exam}</dd>
        <dt className="text-muted-foreground">Ders</dt>
        <dd>{row.subject}</dd>
        <dt className="text-muted-foreground">Kitapçık</dt>
        <dd>{row.booklet}</dd>
        <dt className="text-muted-foreground">Doğru</dt>
        <dd>{row.correct}</dd>
        <dt className="text-muted-foreground">Yanlış</dt>
        <dd>{row.wrong}</dd>
        <dt className="text-muted-foreground">Boş</dt>
        <dd>{row.blank}</dd>
        <dt className="text-muted-foreground">Çoklu işaret</dt>
        <dd>{row.multiple}</dd>
        <dt className="text-muted-foreground">İptal soru</dt>
        <dd>{row.cancelled}</dd>
        <dt className="text-muted-foreground">Net</dt>
        <dd>{row.net}</dd>
      </dl>
      <section className="grid gap-2 border-t pt-4" aria-labelledby="optik-ayrinti-kazanim">
        <h3 id="optik-ayrinti-kazanim" className="text-sm font-semibold">
          Kazanım başarıları
        </h3>
        <DataTable
          listKey={`optik-ayrinti-kazanim:${row.id}`}
          urlPrefix="kazanim-"
          rows={row.topics}
          columns={topicColumns}
          mobileColumns={TOPIC_COLUMNS}
          search={false}
          pageSize={50}
          caption="Kazanım başarıları"
          empty="Bu analizde kazanım sonucu yok."
        />
      </section>
      <section className="grid gap-2 border-t pt-4" aria-labelledby="optik-ayrinti-soru">
        <h3 id="optik-ayrinti-soru" className="text-sm font-semibold">
          Soru ayrıntıları
        </h3>
        <p className="text-xs text-muted-foreground">
          Çoklu işaret yanlış sayılır; iptal edilen sorular kazanım oranından çıkarılır.
        </p>
        <DataTable
          listKey={`optik-ayrinti-soru:${row.id}`}
          urlPrefix="soru-"
          rows={row.questions}
          columns={questionColumns}
          mobileColumns={QUESTION_COLUMNS}
          search={false}
          pageSize={50}
          caption="Soru ayrıntıları"
          empty="Bu analizde soru sonucu yok."
        />
      </section>
    </div>
  )
}
