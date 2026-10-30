import { subjectById } from '../data/curriculum.ts'
import type { State } from '../data/seed.ts'
import { invoiceStatus } from './format.ts'
import { DomainError } from './errors.ts'

function studentContext(state: State, studentId: string | undefined, classId?: string) {
  const student = state.students.find((s) => s.id === studentId)
  if (!student)
    throw new DomainError('student_not_found', 'Belge için öğrenci kaydı bulunamadı.', {
      kind: 'not_found',
    })
  const classroom = state.classes.find((c) => c.id === (classId || student.classId))
  const parent = state.parents.find((p) => p.id === student.parentId)
  const branch = state.branches.find((b) => b.id === classroom?.branchId)
  return { student, classroom, parent, branch }
}

// The same record resolvers serve every role so PDF amounts and people never diverge.
export type DocumentType =
  'receipt' | 'contract' | 'payment-plan' | 'material' | 'homework' | 'submission'

export function documentData(
  state: State,
  type: DocumentType,
  recordId: string,
  studentId?: string,
) {
  if (type === 'receipt') {
    const invoice = state.invoices.find((i) => i.id === recordId)
    if (!invoice?.paidAt)
      throw new DomainError(
        'receipt_unavailable',
        'Dekont yalnızca tamamlanan ödemeler için oluşturulur.',
      )
    return { ...studentContext(state, invoice.studentId), invoice, reference: invoice.id }
  }
  if (type === 'contract' || type === 'payment-plan') {
    const contract = type === 'contract' ? state.contracts.find((c) => c.id === recordId) : null
    if (type === 'contract' && !contract)
      throw new DomainError('contract_not_found', 'Sözleşme kaydı bulunamadı.', {
        kind: 'not_found',
      })
    const context = studentContext(state, contract?.studentId || recordId, contract?.classId)
    const invoices = state.invoices
      .filter(
        (i) =>
          i.studentId === context.student.id &&
          (!contract ||
            (contract.invoiceIds
              ? contract.invoiceIds.includes(i.id)
              : i.contractId
                ? i.contractId === contract.id
                : true)),
      )
      .sort((a, b) => a.installment - b.installment)
      .map((i) => ({ ...i, status: invoiceStatus(i) }))
    return {
      ...context,
      contract,
      invoices,
      total: invoices.reduce((total, i) => total + i.amount, 0),
      paid: invoices.filter((i) => i.paidAt).reduce((total, i) => total + i.amount, 0),
      reference: contract?.id || `plan-${context.student.id}`,
    }
  }
  if (type === 'material') {
    const material = state.materials.find((m) => m.id === recordId)
    if (!material)
      throw new DomainError('material_not_found', 'Materyal kaydı bulunamadı.', {
        kind: 'not_found',
      })
    const subject = subjectById(material.subjectId)
    return {
      ...material,
      teacher: state.teachers.find((t) => t.id === material.teacherId),
      content: material.content || [
        subject?.lesson || material.title,
        subject?.task || material.title,
      ],
      reference: material.id,
    }
  }
  if (type === 'homework' || type === 'submission') {
    const submission =
      type === 'submission' ? state.submissions.find((s) => s.id === recordId) : null
    if (type === 'submission' && !submission)
      throw new DomainError('submission_not_found', 'Ödev teslim kaydı bulunamadı.', {
        kind: 'not_found',
      })
    const homework = state.homework.find((h) => h.id === (submission?.homeworkId || recordId))
    if (!homework)
      throw new DomainError('homework_not_found', 'Ödev kaydı bulunamadı.', { kind: 'not_found' })
    const context =
      submission?.studentId || studentId
        ? studentContext(state, submission?.studentId || studentId)
        : { classroom: state.classes.find((c) => c.id === homework.classId) }
    return {
      ...context,
      homework,
      submission,
      teacher: state.teachers.find((t) => t.id === homework.teacherId),
      reference: submission?.id || homework.id,
    }
  }
  throw new DomainError('unsupported_document_type', 'Belge türü desteklenmiyor.')
}
