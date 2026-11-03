import { useState } from 'react'
import { View } from 'react-native'
import { useUpdateAppointment } from '@kampus/react-shared/use-appointment-commands.ts'
import { APPOINTMENT_REASON_MAX_LENGTH } from '@kampus/school-core/lib/appointments.ts'
import { Badge, Button, Field, Sheet, T, useColors } from '../../ui/components.tsx'
import { DetailPair, Notice, Section } from '../../ui/SchoolLayout.tsx'
import { createFieldCollector } from '../command-failure.ts'
import {
  ACTION_TEXTS,
  actionFailure,
  appointmentBadgeTone,
  cancelReasonLabel,
  checkAction,
  studentActions,
  type AppointmentRow,
} from '../student-appointment.ts'
import { useNotify } from '../toast.tsx'

type Mode = 'withdraw' | 'cancel'

/**
 * Randevu ayrıntısı (alt pencere): bilgiler, durum geçmişi ve işlemler. Öğrenci bekleyen talebini
 * geri çeker, onaylı ve başlamamış randevusunu gerekçeyle iptal eder (DOM-ILT-102). Hangi işlemin
 * sunulacağı satırdan ve sunucu gününden türer; kesin karar sunucudadır ve başlamış randevunun iptali
 * orada Türkçe mesajla reddedilir. Gerekçe yalnız bellekte durur.
 */
export function AppointmentSheet({
  row,
  today,
  onClose,
}: {
  row: AppointmentRow
  today: string | null
  onClose: () => void
}) {
  const c = useColors()
  const actions = studentActions(row, today)
  return (
    <Sheet visible title="Randevu ayrıntısı" onClose={onClose}>
      <T bold size={18}>
        {row.counterpart}
      </T>
      <Badge text={row.status} tone={appointmentBadgeTone(row.status)} />
      <Section title="Bilgiler" panel>
        <View style={{ gap: 12 }}>
          <DetailPair label="Öğretmen" value={row.teacher} />
          <DetailPair label="Tür" value={row.type} />
          <DetailPair label="Tarih ve saat" value={row.when} />
          {row.duration !== null && <DetailPair label="Süre" value={`${row.duration} dk`} />}
        </View>
      </Section>
      <Section title="Konu" panel>
        <T selectable>{row.note}</T>
      </Section>
      <Section title="Geçmiş" panel>
        <View style={{ gap: 10 }} accessibilityRole="list">
          {row.history.map((event) => (
            <View
              key={event.key}
              style={{
                gap: 4,
                padding: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: c.border,
              }}
            >
              <T bold size={14}>
                {event.label}
              </T>
              <T muted size={12}>
                {event.stamp} · {event.by}
              </T>
              {!!event.reason && <T selectable>{event.reason}</T>}
            </View>
          ))}
        </View>
      </Section>
      <Actions
        row={row}
        withdraw={actions.includes('withdraw')}
        cancel={actions.includes('cancel')}
        onDone={onClose}
      />
    </Sheet>
  )
}

/**
 * İşlemler: önce onay sorulur (geri alınamaz); iptalde gerekçe zorunludur. `If-Match` okunan
 * sürümdür; randevu bu arada değiştiyse (409) liste tazelenir ve Türkçe mesaj gösterilir. Düğme
 * gönderimde kilitlenir; ağ hatasında "Yeniden dene" aynı gövdeyi aynı anahtarla gönderir.
 */
function Actions({
  row,
  withdraw,
  cancel,
  onDone,
}: {
  row: AppointmentRow
  withdraw: boolean
  cancel: boolean
  onDone: () => void
}) {
  const notify = useNotify()
  const update = useUpdateAppointment()
  const [mode, setMode] = useState<Mode | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>()
  const [failure, setFailure] = useState<ReturnType<typeof actionFailure> | null>(null)

  async function confirm(action: Mode) {
    if (update.isPending) return
    const check = checkAction(action, action === 'cancel' ? reason : '')
    if (!check.ok) {
      setReasonError(check.message)
      setFailure(null)
      return
    }
    setReasonError(undefined)
    setFailure(null)
    const collector = createFieldCollector()
    const outcome = await update.submit(
      { appointmentId: row.id, version: row.version, body: check.body },
      { setError: collector.setError, silent: () => true },
    )
    if (outcome.status === 'busy') return
    if (outcome.status === 'failed') {
      const next = actionFailure(outcome.error, collector.fields)
      setReasonError(next.errors.reason)
      setFailure(next)
      // Belirsiz hatada (ağ, 5xx) onay açık kalır ki aynı işlem yeniden denenebilsin.
      if (!next.retryable) setMode(null)
      return
    }
    notify(ACTION_TEXTS[action].done)
    onDone()
  }

  if (!withdraw && !cancel && !failure?.message) return null
  const retry = failure?.retryable === true
  return (
    <>
      {failure?.message && (
        <Notice tone="red" title="İşlem yapılamadı" text={failure.message}>
          {retry && <T size={13}>İşlem tamamlanmış olabilir; yeniden denemek güvenlidir.</T>}
        </Notice>
      )}
      {mode === null ? (
        <Section title="İşlemler" panel>
          {withdraw && (
            <Button icon="ArrowLeft" onPress={() => setMode('withdraw')}>
              Talebi geri çek
            </Button>
          )}
          {cancel && (
            <Button danger icon="X" onPress={() => setMode('cancel')}>
              Randevuyu iptal et
            </Button>
          )}
        </Section>
      ) : (
        <Notice title={ACTION_TEXTS[mode].title} text={ACTION_TEXTS[mode].description} tone="amber">
          {mode === 'cancel' && (
            <Field
              label={cancelReasonLabel()}
              value={reason}
              onChange={(next) => {
                setReason(next)
                setReasonError(undefined)
              }}
              multiline
              maxLength={APPOINTMENT_REASON_MAX_LENGTH}
              hint={`En çok ${APPOINTMENT_REASON_MAX_LENGTH} karakter.`}
              editable={!update.isPending}
              {...(reasonError ? { error: reasonError } : {})}
            />
          )}
          <Button
            danger
            icon={mode === 'cancel' ? 'X' : 'ArrowLeft'}
            disabled={update.isPending}
            label={update.isPending ? 'İşlem yapılıyor' : ACTION_TEXTS[mode].confirm}
            onPress={() => void confirm(mode)}
          >
            {update.isPending
              ? 'Gönderiliyor…'
              : retry
                ? 'Yeniden dene'
                : ACTION_TEXTS[mode].confirm}
          </Button>
          <Button disabled={update.isPending} onPress={() => setMode(null)}>
            Vazgeç
          </Button>
        </Notice>
      )}
    </>
  )
}
