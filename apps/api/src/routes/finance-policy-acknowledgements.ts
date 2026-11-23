import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_POLICY_MANAGE_ROLES,
  FINANCE_POLICY_ROLES,
  policyAcknowledgementInputSchema,
  policyDocumentInputSchema,
} from '@kampus/school-core/lib/finance-policy-acknowledgements.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  createPolicyAcknowledgementCommand,
  createPolicyDocumentCommand,
  getPolicyDocumentFor,
  listPolicyDocumentStaffFor,
  listPolicyDocumentsFor,
  listPolicyStaffFor,
} from '../services/finance-policy-acknowledgements.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  policyAcknowledgementResponse,
  policyDocumentDetailResponse,
  policyDocumentListQuery,
  policyDocumentListResponse,
  policyDocumentParams,
  policyDocumentResponse,
  policyDocumentStaffListResponse,
  policyDocumentStaffQuery,
  policyStaffListResponse,
  policyStaffQuery,
} from './finance-policy-acknowledgements.schemas.ts'

/**
 * Politika belgesi okundu onayı uçları (docs/domain/finans.md DOM-FIN-127; ON-190). Modül
 * `finance`; okuma ve onay kaydı yönetici ve ön büro, belge ve yeni sürüm yayımlama yalnız
 * yönetici (K-437). Sıra: 401 → 403 modül → 403 rol → 400 → işlem. Belge ve onay silinmez.
 */

const STAFF = 'Rol: `yonetici` ve `onburo`. Modül `finance`.'
const MANAGER = 'Rol: yalnız `yonetici` (ön büro 403). Modül `finance`.'
const DOCS = '/api/v1/finance/policy-documents'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinancePolicyAcknowledgementRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const tags = ['finance-policy-acknowledgements']

  typed.get(
    DOCS,
    {
      preValidation: guarded(FINANCE_POLICY_ROLES),
      schema: {
        operationId: 'listPolicyDocuments',
        tags,
        summary: 'Politika belgeleri ve onay oranı',
        description: `Belgeler en yeni yayın önce; her satırda hedef kitledeki etkin personel, bu sürümü onaylayan ve onaylamayan sayısı ile oran (K-438). \`status=current\` (varsayılan) yalnız geçerli sürümler; yeni sürüm yayımlanınca önceki sürümün onayları yeni sürüme sayılmaz (K-436). ${STAFF}`,
        querystring: policyDocumentListQuery,
        response: { 200: policyDocumentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, policyType, status } = request.query
      const { items, total } = await listPolicyDocumentsFor(contextOf(request), {
        page,
        pageSize,
        q,
        policyType,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    DOCS,
    {
      preValidation: [...guarded(FINANCE_POLICY_MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPolicyDocument',
        tags,
        summary: 'Politika belgesi ya da yeni sürüm yayımla',
        description: `Ad, tür, hedef kitle, yayın günü (bugünden sonra olamaz, 422 \`policy_published_in_future\`) ve PDF (\`POST /files\` amaç \`document\`; yükleyenin, hazır ve bağsız olmalı). \`replacesDocumentId\` verilirse yeni sürüm olur: önceki sürüm geçerli olmalı (422 \`policy_previous_not_found\`, \`policy_previous_superseded\`), yayın günü öncekinden önce olamaz (422 \`policy_published_before_previous\`); önceki sürümün onayları geçersiz sayılır, personel yeniden onaylar (K-436). Denetim \`finance.policy_document.create\` (ve \`supersede\`). \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: policyDocumentInputSchema,
        response: { 201: policyDocumentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPolicyDocumentCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = policyDocumentResponse.parse(sendBody(reply, result))
      reply.header('location', `${DOCS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${DOCS}/:documentId`,
    {
      preValidation: guarded(FINANCE_POLICY_ROLES),
      schema: {
        operationId: 'getPolicyDocument',
        tags,
        summary: 'Politika belgesi sürümü ve sürüm geçmişi',
        description: `Sürümün onay sayıları ve aynı belgenin bütün sürümleri (en yeni önce). Başka kurumun belgesi 404. ${STAFF}`,
        params: policyDocumentParams,
        response: { 200: policyDocumentDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getPolicyDocumentFor(contextOf(request), request.params.documentId),
    }),
  )

  typed.get(
    `${DOCS}/:documentId/staff`,
    {
      preValidation: guarded(FINANCE_POLICY_ROLES),
      schema: {
        operationId: 'listPolicyDocumentStaff',
        tags,
        summary: 'Belgeyi onaylamayan ya da onaylayan personel',
        description: `Sürümün hedef kitlesindeki etkin personel ada göre; \`status=pending\` (varsayılan) onaylamayanlar, \`acknowledged\` onaylayanlar (onay günü, kanal, tarama). Başka kurumun belgesi 404. ${STAFF}`,
        params: policyDocumentParams,
        querystring: policyDocumentStaffQuery,
        response: { 200: policyDocumentStaffListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status } = request.query
      const { items, total } = await listPolicyDocumentStaffFor(
        contextOf(request),
        request.params.documentId,
        { page, pageSize, q, status },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/policy-acknowledgement-staff',
    {
      preValidation: guarded(FINANCE_POLICY_ROLES),
      schema: {
        operationId: 'listPolicyAcknowledgementStaff',
        tags,
        summary: 'Personel başına eksik politika onayları',
        description: `Etkin personel ada göre; her satırda hedef kitlesinde olduğu geçerli sürüm sayısı, onayladığı ve onaylamadığı belgeler. \`missing=true\` yalnız eksiği olanlar. ${STAFF}`,
        querystring: policyStaffQuery,
        response: { 200: policyStaffListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, missing } = request.query
      const { items, total } = await listPolicyStaffFor(contextOf(request), {
        page,
        pageSize,
        q,
        missing: missing === 'true',
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/policy-acknowledgements',
    {
      preValidation: [...guarded(FINANCE_POLICY_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPolicyAcknowledgement',
        tags,
        summary: 'Personel adına okundu onayı kaydet',
        description: `Personel kendi onayını veremediğinde yönetici ya da ön büro "okundu ve imzalandı" kaydını kanal (ıslak imzalı form, e-posta, yüz yüze) ve onay günüyle girer; ıslak imza taraması isteğe bağlı dosyadır (\`POST /files\` amaç \`document\`; K-437). Belge geçerli sürüm olmalı (422 \`policy_not_found\`, \`policy_version_superseded\`); personel etkin ve hedef kitlede olmalı (422 \`policy_staff_not_found\`, \`policy_not_staff\`, \`policy_staff_inactive\`, \`policy_not_in_audience\`); onay günü yayın gününden önce ya da bugünden sonra olamaz (422 \`policy_ack_before_publish\`, \`policy_ack_in_future\`). Aynı sürüme ikinci onay 409 \`policy_already_acknowledged\`. Onay silinmez ve düzeltilmez. Denetim \`finance.policy_acknowledgement.create\` (alan adları). \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: policyAcknowledgementInputSchema,
        response: { 201: policyAcknowledgementResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPolicyAcknowledgementCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return policyAcknowledgementResponse.parse(sendBody(reply, result))
    },
  )
}
