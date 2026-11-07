'use client'

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { useTheme } from '@/hooks/use-theme'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{ classNames: { toast: 'toast glass-menu' } }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          // Cam zemin; azaltılmış saydamlık/yüksek kontrastta token opak yüzeye düşer.
          '--normal-bg': 'var(--glass-menu)',
          '--normal-text': 'var(--text)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius-field)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
