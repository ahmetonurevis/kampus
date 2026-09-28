import { nextTick, ref, useId } from 'vue'
import { notify } from '../stores/demo.js'

export function useFormErrors(formElement) {
  const errors = ref({})
  const prefix = useId()
  const errorId = (name) => `${prefix}-${name}-error`
  function field(name, label) {
    const clearField = () => {
      delete errors.value[name]
    }
    return {
      name,
      'data-field': name,
      'aria-label': label,
      'aria-invalid': !!errors.value[name],
      'aria-describedby': errors.value[name] ? errorId(name) : undefined,
      onInput: clearField,
      onChange: clearField,
    }
  }
  async function focusFirst() {
    await nextTick()
    const input = formElement.value?.querySelector('[aria-invalid="true"]')
    input?.focus()
    input?.scrollIntoView({ block: 'nearest' })
  }
  function show(next) {
    errors.value = next
    if (!Object.keys(next).length) return true
    notify('İşaretli alanları kontrol edin.', 'error')
    focusFirst()
    return false
  }
  function validate(schema, data) {
    const result = schema.safeParse(data)
    const next = {}
    if (!result.success)
      for (const issue of result.error.issues) next[issue.path.join('.')] ??= issue.message
    return show(next)
  }
  function clear() {
    errors.value = {}
  }
  return { errors, errorId, field, validate, show, clear, focusFirst }
}
