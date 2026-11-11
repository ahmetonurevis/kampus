import { cn } from '@/lib/utils'

type FormStepsProps = {
  steps: readonly string[]
  current: number
  /** Tamamlanmış bir adıma geri dönüş. */
  onBack: (index: number) => void
}

/** Adımlı form göstergesi (Vue `FormSteps.vue`): yalnız tamamlanan adımlara dönülebilir. */
export function FormSteps({ steps, current, onBack }: FormStepsProps) {
  return (
    <ol className="form-steps flex flex-wrap gap-2" aria-label="Form adımları">
      {steps.map((step, index) => {
        const number = (
          <span
            className={cn(
              'grid size-6 place-items-center rounded-full border text-2xs font-semibold',
              index <= current && 'border-primary bg-primary text-primary-foreground',
            )}
          >
            {index + 1}
          </span>
        )
        const content = 'flex min-h-9 items-center gap-2 rounded-xl px-2.5 text-sm'
        return (
          <li
            key={step}
            aria-current={index === current ? 'step' : undefined}
            className={cn(
              index === current ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            {index < current ? (
              <button
                type="button"
                onClick={() => onBack(index)}
                className={cn(content, 'hover:bg-secondary')}
              >
                {number}
                {step}
              </button>
            ) : (
              <div className={content}>
                {number}
                {step}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
