import { Icon } from '@/components/Icon.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import type { SessionChild } from '@/auth/auth-port.ts'
import { childNamesPending } from '@/auth/session-mapping.ts'

type ChildBarProps = {
  options: readonly SessionChild[]
  value: string
  onChange: (childId: string) => void
}

/** Veli çocuk seçici çubuğu (Vue `.child-bar`): sayfadaki bütün bilgiler seçili çocuğa aittir. */
export function ChildBar({ options, value, onChange }: ChildBarProps) {
  // TODO(D1b1): çocuk adları öğrenci okuma ucundan gelene kadar seçici yükleniyor durumundadır;
  // kayıt kimliği veya uydurma ad etiket yapılmaz.
  const pending = childNamesPending(options)
  return (
    <div className="child-bar mb-6 flex items-center gap-4 rounded-2xl border bg-primary-soft px-[18px] py-3 text-sm max-[650px]:mb-[23px] max-[650px]:flex-wrap max-[650px]:gap-2.5 max-[650px]:p-3">
      <span className="flex items-center gap-2 font-medium text-primary max-[650px]:text-xs">
        <Icon name="HeartHandshake" size={18} aria-hidden="true" />
        Şu an görüntülenen öğrenci
      </span>
      <div className="max-[650px]:ml-auto">
        <NativeSelect
          aria-label="Çocuk seç"
          aria-busy={pending || undefined}
          disabled={pending}
          value={pending ? '' : value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-8 bg-surface py-[5px] pr-7 pl-2.5 text-sm max-[650px]:min-h-11 max-[650px]:max-w-[160px]"
        >
          {pending ? (
            <NativeSelectOption value="">Öğrenciler yükleniyor…</NativeSelectOption>
          ) : (
            options.map((child) => (
              <NativeSelectOption key={child.id} value={child.id}>
                {child.name}
              </NativeSelectOption>
            ))
          )}
        </NativeSelect>
      </div>
      <span className="ml-auto text-xs text-muted-foreground max-[650px]:ml-0 max-[650px]:w-full">
        Tüm bilgiler seçili çocuğunuza aittir.
      </span>
    </div>
  )
}
