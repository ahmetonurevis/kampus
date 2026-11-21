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

function receiptData(state: State, recordId: string) {
  const invoice = state.invoices.find((i) => i.id === recordId)
  if (!invoice?.paidAt)
    throw new DomainError(
      'receipt_unavailable',
      'Dekont yalnızca tamamlanan ödemeler için oluşturulur.',
    )
  return { ...studentContext(state, invoice.studentId), invoice, reference: invoice.id }
}

/** Sözleşme ve taksit taahhütnamesi aynı ödeme planı verisini kullanır. */
function planData(state: State, type: 'contract' | 'payment-plan', recordId: string) {
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

function materialData(state: State, recordId: string) {
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

/** Ödev ve teslim belgesi aynı ödev verisini kullanır; teslimde öğrenci tesliminden gelir. */
function homeworkData(
  state: State,
  type: 'homework' | 'submission',
  recordId: string,
  studentId: string | undefined,
) {
  const submission = type === 'submission' ? state.submissions.find((s) => s.id === recordId) : null
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

/** Belge türü → belge verisi; PDF şablonu türüne göre alanları tip denetimiyle okur. */
export type DocumentDataMap = {
  receipt: ReturnType<typeof receiptData>
  contract: ReturnType<typeof planData>
  'payment-plan': ReturnType<typeof planData>
  material: ReturnType<typeof materialData>
  homework: ReturnType<typeof homeworkData>
  submission: ReturnType<typeof homeworkData>
}
export type DocumentData = DocumentDataMap[DocumentType]

/**
 * Belge verisi. Tür sabit verilince dönüş tipi o türün verisidir; tür birleşim olarak verilince
 * (`DocumentType`) bütün belge verilerinin birleşimidir.
 */
export function documentData<T extends DocumentType>(
  state: State,
  type: T,
  recordId: string,
  studentId?: string,
): DocumentDataMap[T]
export function documentData(
  state: State,
  type: DocumentType,
  recordId: string,
  studentId?: string,
): DocumentData {
  switch (type) {
    case 'receipt':
      return receiptData(state, recordId)
    case 'contract':
    case 'payment-plan':
      return planData(state, type, recordId)
    case 'material':
      return materialData(state, recordId)
    case 'homework':
    case 'submission':
      return homeworkData(state, type, recordId, studentId)
  }
  // Tür dışarıdan (URL, eski kayıt) gelebilir; tip dışı değer burada reddedilir.
  throw new DomainError('unsupported_document_type', 'Belge türü desteklenmiyor.')
}
