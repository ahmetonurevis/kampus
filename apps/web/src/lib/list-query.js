import { dayKey } from './format.js'

export function pageNumbers(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const selected = new Set([1, pages, page - 1, page, page + 1])
  const values = [...selected].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  return values.flatMap((n, i) => {
    const gap = i ? n - values[i - 1] : 0
    return gap === 2 ? [n - 1, n] : gap > 2 ? [`gap-${n}`, n] : [n]
  })
}

export function filterRows(rows, query, fields, values, searchKeys) {
  const terms = query.trim().toLocaleLowerCase('tr').split(/\s+/).filter(Boolean)
  return rows.filter((row) => {
    const haystack = searchKeys
      .map((key) => {
        const value = row[key]
        return typeof value === 'string' || typeof value === 'number' ? value : ''
      })
      .join(' ')
      .toLocaleLowerCase('tr')
    if (!terms.every((term) => haystack.includes(term))) return false
    return fields.every((field) => {
      const selected = values[field.key]
      if (!hasFilter(selected)) return true
      const value = row[field.key]
      if (value == null || value === '') return false
      if (field.type === 'date') {
        const day = dayKey(value)
        return (!selected.min || day >= selected.min) && (!selected.max || day <= selected.max)
      }
      if (field.type === 'number') {
        const number = Number(value) / (field.divisor || 1)
        return (
          Number.isFinite(number) &&
          (selected.min === '' || selected.min == null || number >= Number(selected.min)) &&
          (selected.max === '' || selected.max == null || number <= Number(selected.max))
        )
      }
      return String(value) === String(selected)
    })
  })
}

const selects = new Set([
  'class',
  'branch',
  'subject',
  'level',
  'grade',
  'status',
  'statusLabel',
  'risk',
  'stage',
  'source',
  'interest',
  'category',
  'assignedTo',
  'teacher',
  'type',
  'role',
  'actor',
  'permission',
  'method',
  'topic',
])
const dates = new Set(['date', 'dueDate', 'submittedAt', 'createdAt', 'paidAt'])
const numbers = new Set([
  'score',
  'amount',
  'installment',
  'absent',
  'average',
  'performance',
  'attendanceRate',
  'homeworkRate',
  'count',
  'occupancy',
  'breaches',
  'pending',
  'slaRate',
  'students',
  'duration',
  'enrolled',
])
export function columnFilters(columns) {
  return columns.flatMap(({ key, label }) => {
    if (selects.has(key)) return [{ key, label }]
    if (dates.has(key)) return [{ key, label, type: 'date' }]
    if (numbers.has(key))
      return [
        {
          key,
          label: key === 'amount' ? 'Tutar (₺)' : label,
          type: 'number',
          divisor: key === 'amount' ? 100 : 1,
        },
      ]
    return []
  })
}

export function hasFilter(value) {
  return typeof value === 'object' && value !== null
    ? [value.min, value.max].some((v) => v !== '' && v != null)
    : value !== '' && value != null
}
