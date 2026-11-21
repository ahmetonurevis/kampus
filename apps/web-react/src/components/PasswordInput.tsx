import { useState, type ComponentProps } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'> & {
  autoComplete: 'current-password' | 'new-password'
}

/**
 * Parola alanı ve "parolayı göster" düğmesi (WCAG 3.3.8, guvenlik-kvkk.md §2). Yapıştırma ve parola
 * yöneticisi engellenmez. `register` çıktısı (ref dahil) doğrudan verilir.
 */
export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="none"
        className={cn('pr-12', className)}
      />
      <button
        type="button"
        aria-pressed={visible}
        aria-label={visible ? 'Parolayı gizle' : 'Parolayı göster'}
        aria-controls={props.id}
        onClick={() => setVisible((value) => !value)}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Icon name={visible ? 'EyeOff' : 'Eye'} size={18} />
      </button>
    </div>
  )
}
