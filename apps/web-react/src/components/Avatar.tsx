import { Avatar as AvatarRoot, AvatarFallback } from '@/components/ui/avatar'
import { avatarTone, initials } from '@/lib/avatar.ts'
import { cn } from '@/lib/utils'

// Ton sınıfları Vue `.avatar-0…4` ile aynı sırada; renk normalleştirilmiş tam addan gelir.
const TONES = [
  'bg-info-soft text-info',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-danger-soft text-danger',
  'bg-primary-soft text-primary',
] as const

const SIZES = {
  small: 'size-8 text-xs',
  medium: 'size-[38px] text-sm',
  large: 'size-[72px] text-[21px]',
} as const

type AvatarProps = {
  name: string
  size?: keyof typeof SIZES
  className?: string
}

/** Kişi avatarı; ad yanında görünür metin olarak bulunduğu için süs öğesidir. */
export function Avatar({ name, size = 'medium', className }: AvatarProps) {
  return (
    <AvatarRoot aria-hidden="true" className={cn(SIZES[size], className)}>
      <AvatarFallback className={cn('font-semibold tracking-[0.1px]', TONES[avatarTone(name)])}>
        {initials(name)}
      </AvatarFallback>
    </AvatarRoot>
  )
}
