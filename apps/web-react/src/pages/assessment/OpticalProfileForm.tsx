import { zodResolver } from '@hookform/resolvers/zod'
import { useId, type ChangeEvent } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { fileFailure } from '@kampus/react-shared/assessment-feedback.ts'
import { useSaveOpticalProfile } from '@kampus/react-shared/use-assessment-commands.ts'
import { automationSchemas } from '@kampus/school-core/lib/assessment-automation.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import {
  answerFileProblem,
  decodeAnswerFile,
  formFieldOf,
  profileFormDefaults,
  type Profile,
  type ProfileFormInput,
  type ProfileFormOutput,
} from './optical-model.ts'

type Props = {
  /** `null`: yeni profil; kayıt: mevcut profil düzenleme (profilin sınavı değişmez). */
  profile: Profile | null
  /** Yeni profil için seçilebilir denemeler (profili olmayanlar). */
  exams: readonly { id: string; title: string }[]
  /** Düzenlenen profilin okunan sürümü (`If-Match`). */
  version: number | undefined
  onClose: () => void
}

/**
 * Optik profil ve cevap anahtarı formu (yalnız yönetici; sunucu da zorlar). Alan sayısı çok
 * olduğundan geniş pencerede açılır. Doğrulama core `automationSchemas.profile` şemasıyla
 * (`zodResolver`); sunucu hatası alanlara yazılır, cevap anahtarındaki satır hatası satır
 * numarasıyla `keyCsv` altında görünür.
 */
export function OpticalProfileForm({ profile, exams, version, onClose }: Props) {
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={profile ? 'Optik profili düzenle' : 'Optik profil ekle'}
      description="Okuyucu dosyasının biçimini ve sınavın cevap anahtarını tanımlayın."
      size="wide"
    >
      <ProfileForm profile={profile} exams={exams} version={version} onClose={onClose} />
    </Modal>
  )
}

function ProfileForm({ profile, exams, version, onClose }: Props) {
  const prefix = useId()
  const save = useSaveOpticalProfile()
  const form = useForm<ProfileFormInput, unknown, ProfileFormOutput>({
    resolver: zodResolver(automationSchemas.profile),
    defaultValues: profileFormDefaults(profile ?? undefined, exams[0]?.id ?? ''),
  })
  const format = useWatch({ control: form.control, name: 'format' })
  const errors = form.formState.errors
  const busy = save.isPending || form.formState.isSubmitting
  const id = (name: string) => `${prefix}-${name}`

  async function loadKey(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    const problem = answerFileProblem(file)
    if (problem) form.setError('keyCsv', { type: 'file', message: problem })
    else {
      try {
        const decoded = decodeAnswerFile(new Uint8Array(await file.arrayBuffer()))
        form.setValue('keyCsv', decoded.text, { shouldDirty: true, shouldValidate: true })
      } catch (error) {
        notify.error('Dosya okunamadı. Başka bir dosya seçip yeniden deneyin.', error)
      }
    }
    input.value = ''
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await save.submit(
      { recordId: profile?.id, version, body: values },
      {
        setError: (name, issue) =>
          form.setError(formFieldOf(name) as keyof ProfileFormInput, issue),
      },
    )
    if (outcome.status === 'success') {
      notify.success(profile ? 'Optik profil güncellendi.' : 'Optik profil eklendi.')
      onClose()
      return
    }
    if (outcome.status !== 'failed') return
    const failure = fileFailure(outcome.error, 'keyCsv')
    if (failure) form.setError('keyCsv', { type: outcome.error.code, message: failure.message })
  })

  const number = (name: keyof ProfileFormInput, label: string, hint?: string) => (
    <FormField
      id={id(name)}
      label={label}
      error={errors[name]}
      {...(hint ? { description: hint } : {})}
    >
      {(control) => (
        <Input {...control} type="number" inputMode="numeric" {...form.register(name)} />
      )}
    </FormField>
  )

  return (
    <form
      noValidate
      aria-label={profile ? 'Optik profili düzenle' : 'Optik profil ekle'}
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {profile ? (
          // Profilin sınavı değişmez; değer varsayılan değerden gider (kapalı alan gönderilmez).
          <div className="grid gap-2 text-sm">
            <span className="font-medium">Deneme</span>
            <span>{exams.find((exam) => exam.id === profile.examId)?.title ?? profile.examId}</span>
          </div>
        ) : (
          <FormField id={id('examId')} label="Deneme" error={errors.examId}>
            {(control) => (
              <NativeSelect {...control} {...form.register('examId')} className="w-full">
                {exams.map((exam) => (
                  <NativeSelectOption key={exam.id} value={exam.id}>
                    {exam.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
        <FormField id={id('title')} label="Profil adı" error={errors.title}>
          {(control) => <Input {...control} {...form.register('title')} />}
        </FormField>
        <FormField id={id('format')} label="Dosya biçimi" error={errors.format}>
          {(control) => (
            <NativeSelect {...control} {...form.register('format')} className="w-full">
              <NativeSelectOption value="csv">CSV (student;booklet;answers)</NativeSelectOption>
              <NativeSelectOption value="fixed">DAT/TXT (sabit alanlı)</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
        <FormField id={id('identifier')} label="Öğrenci eşleşmesi" error={errors.identifier}>
          {(control) => (
            <NativeSelect {...control} {...form.register('identifier')} className="w-full">
              <NativeSelectOption value="number">Okul numarası</NativeSelectOption>
              <NativeSelectOption value="id">Öğrenci kimliği</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
      </div>
      {format === 'fixed' ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Sabit alan konumları</legend>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Başlangıç konumları 1&apos;den sayılır; alanlar çakışamaz ve cevap uzunluğu anahtardaki
            soru sayısına eşit olmalıdır.
          </p>
          {number('headerLines', 'Atlanacak başlık satırı')}
          <div className="hidden sm:block" aria-hidden="true" />
          {number('studentStart', 'Öğrenci alanı başlangıcı')}
          {number('studentLength', 'Öğrenci alanı uzunluğu')}
          {number('bookletStart', 'Kitapçık alanı başlangıcı')}
          {number('bookletLength', 'Kitapçık alanı uzunluğu')}
          {number('answersStart', 'Cevap alanı başlangıcı')}
          {number('answersLength', 'Cevap alanı uzunluğu')}
        </fieldset>
      ) : null}
      <FormField
        id={id('keyCsv')}
        label="Cevap anahtarı (CSV)"
        error={errors.keyCsv}
        description="Başlık: booklet;question;subjectId;topic;answer. Her soru bir ders koduna ve kazanıma bağlanır; iptal soru cevabı - olur."
      >
        {(control) => (
          <Textarea
            {...control}
            {...form.register('keyCsv')}
            rows={10}
            spellCheck={false}
            className="font-mono text-sm"
          />
        )}
      </FormField>
      <FormField id={id('keyFile')} label="Anahtar dosyası yükle (isteğe bağlı)">
        {(control) => (
          <Input
            {...control}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={(event) => void loadKey(event)}
          />
        )}
      </FormField>
      {errors.root?.server?.message ? (
        <p role="alert" className="text-sm text-danger">
          {errors.root.server.message}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Kaydediliyor…' : 'Profili kaydet'}
        </Button>
      </div>
    </form>
  )
}
