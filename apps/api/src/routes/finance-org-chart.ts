import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_ORG_CHART_ROLES,
  orgAssignmentInputSchema,
  orgAssignmentUpdateSchema,
  orgPositionInputSchema,
  orgPositionUpdateSchema,
  orgUnitInputSchema,
  orgUnitUpdateSchema,
} from '@kampus/school-core/lib/finance-org-chart.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveAssignmentCommand,
  archivePositionCommand,
  assignmentsFor,
  createAssignmentCommand,
  createPositionCommand,
  createUnitCommand,
  orgChartFor,
  updateAssignmentCommand,
  updatePositionCommand,
  updateUnitCommand,
  vacanciesFor,
} from '../services/finance-org-chart.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  archiveResponse,
  assignmentListQuery,
  assignmentListResponse,
  assignmentParams,
  assignmentResponse,
  orgChartQuery,
  orgChartResponse,
  positionParams,
  positionResponse,
  unitParams,
  unitResponse,
  vacancyListQuery,
  vacancyListResponse,
} from './finance-org-chart.schemas.ts'

/**
 * Organizasyon şeması uçları (docs/domain/finans.md DOM-FIN-129; ON-187). Modül `finance`; okuma ve
 * yazma yalnız yönetici (K-444). Yeni birim, pozisyon ve atama `Idempotency-Key`; değişiklik ve
 * kaldırma `If-Match` ister.
 */

const ROLE = 'Rol: yalnız `yonetici` (K-444). Modül `finance`.'
const BASE = '/api/v1/finance'
const UNITS = `${BASE}/org-units`
const POSITIONS = `${BASE}/org-positions`
const ASSIGNMENTS = `${BASE}/org-assignments`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceOrgChartRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_ORG_CHART_ROLES),
  ]
  const tags = ['finance-org-chart']
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })
  const changeHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    `${BASE}/org-chart`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getOrgChart',
        tags,
        summary: 'Organizasyon şeması',
        description: `Görsel şema verisi (DOM-FIN-129): bütün birimler (pasifler dahil), kaldırılmamış pozisyonlar ve verilen gün (varsayılan bugün) pozisyonda süren atamalar; dolu ve boş kadro, toplamlar. Kurum başına birim ≤ 300 ve pozisyon ≤ 1000 olduğu için sayfasızdır. ${ROLE}`,
        querystring: orgChartQuery,
        response: { 200: orgChartResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await orgChartFor(contextOf(request), request.query.date) }),
  )

  typed.get(
    `${BASE}/org-vacancies`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listOrgVacancies',
        tags,
        summary: 'Boş pozisyonlar',
        description: `Verilen gün (varsayılan bugün) kadrosu dolmamış pozisyonlar (K-444): dolu = o gün süren atama, boş = kadro − dolu. Pasif birimin pozisyonu listelenmez. Birim adına ve unvana göre; birimle süzülür, unvanda ya da birim adında aranır. ${ROLE}`,
        querystring: vacancyListQuery,
        response: { 200: vacancyListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, date, unitId, q } = request.query
      const { items, total, day } = await vacanciesFor(contextOf(request), {
        page,
        pageSize,
        ...(date === undefined ? {} : { date }),
        ...(unitId === undefined ? {} : { unitId }),
        ...(q === undefined ? {} : { q }),
      })
      return { data: items, meta: { page, pageSize, total, date: day } }
    },
  )

  typed.post(
    UNITS,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createOrgUnit',
        tags,
        summary: 'Birim ekle',
        description: `Yeni birim etkin açılır (K-442). Üst birim kurumda olmalı (422 \`org_unit_parent_not_found\`) ve etkin olmalı (422 \`org_unit_parent_inactive\`); ağaç en fazla 10 düzey (422 \`org_unit_too_deep\`); aynı üst birimde aynı ad 409 \`org_unit_name_taken\`; kurumda en fazla 300 birim (422 \`org_unit_limit\`). Denetim kaydına alan adları yazılır. \`Idempotency-Key\` zorunlu. ${ROLE}`,
        headers: createHeaders,
        body: orgUnitInputSchema,
        response: { 201: unitResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createUnitCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return unitResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${UNITS}/:unitId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateOrgUnit',
        tags,
        summary: 'Birimi düzelt, taşı ya da pasife al',
        description: `Ad, üst birim, tür ve etkinlik kısmi yazılır (K-442). Birim kendisinin ya da alt biriminin altına taşınamaz (422 \`org_unit_cycle\`); etkin alt birimi (422 \`org_unit_has_active_children\`) ya da süren veya başlayacak ataması (422 \`org_unit_has_assignments\`) olan birim pasife alınamaz; etkin birim pasif üst birime bağlanamaz (422 \`org_unit_parent_inactive\`). Değişiklik yoksa 422 \`org_unit_unchanged\`. \`If-Match\` zorunlu. Başka kurumun birimi 404. ${ROLE}`,
        headers: changeHeaders,
        params: unitParams,
        body: orgUnitUpdateSchema,
        response: { 200: unitResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateUnitCommand(
        contextOf(request),
        request.params.unitId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return unitResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    POSITIONS,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createOrgPosition',
        tags,
        summary: 'Pozisyon aç',
        description: `Birimde unvan, kadro sayısı (1–500) ve raporladığı pozisyon (K-443). Birim kurumda (422 \`org_position_unit_not_found\`) ve etkin olmalı (422 \`org_unit_inactive\`); raporlanan pozisyon kurumda olmalı (422 \`org_position_reports_to_not_found\`); aynı birimde aynı unvan 409 \`org_position_title_taken\`; kurumda en fazla 1000 pozisyon (422 \`org_position_limit\`). Kadro planındaki açık pozisyon (DOM-FIN-126) ayrı kayıttır. \`Idempotency-Key\` zorunlu. ${ROLE}`,
        headers: createHeaders,
        body: orgPositionInputSchema,
        response: { 201: positionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPositionCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return positionResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${POSITIONS}/:positionId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateOrgPosition',
        tags,
        summary: 'Pozisyonu düzelt',
        description: `Birim, unvan, kadro sayısı ve raporlama hattı kısmi yazılır (K-443). Pozisyon kendisine ya da kendisine raporlayan pozisyona raporlayamaz (422 \`org_position_cycle\`); kadro sayısı bugünden sonraki herhangi bir günün atama sayısının altına inemez (422 \`org_position_headcount_below_assigned\`). Değişiklik yoksa 422 \`org_position_unchanged\`. \`If-Match\` zorunlu. Başka kurumun ya da kaldırılmış pozisyon 404. ${ROLE}`,
        headers: changeHeaders,
        params: positionParams,
        body: orgPositionUpdateSchema,
        response: { 200: positionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updatePositionCommand(
        contextOf(request),
        request.params.positionId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return positionResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${POSITIONS}/:positionId`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'archiveOrgPosition',
        tags,
        summary: 'Pozisyonu kaldır',
        description: `Pozisyon arşivlenir; geçmiş atamaları kalır (K-443). Kendisine raporlayan pozisyon (422 \`org_position_has_reports\`) ya da süren veya başlayacak ataması (422 \`org_position_has_assignments\`) varken kaldırılmaz. \`If-Match\` zorunlu. Başka kurumun ya da kaldırılmış pozisyon 404. ${ROLE}`,
        headers: changeHeaders,
        params: positionParams,
        response: { 200: archiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archivePositionCommand(
        contextOf(request),
        request.params.positionId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return archiveResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    ASSIGNMENTS,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listOrgAssignments',
        tags,
        summary: 'Atamalar',
        description: `Personelin pozisyon atamaları (K-444), başlangıca göre yeniden eskiye; pozisyon, personel ve durumla (verilen güne göre süren, başlayacak, bitti) süzülür. Kaldırılmış pozisyonun geçmiş atamaları da listelenir. ${ROLE}`,
        querystring: assignmentListQuery,
        response: { 200: assignmentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, date, positionId, membershipId, state } = request.query
      const { items, total } = await assignmentsFor(contextOf(request), {
        page,
        pageSize,
        ...(date === undefined ? {} : { date }),
        ...(positionId === undefined ? {} : { positionId }),
        ...(membershipId === undefined ? {} : { membershipId }),
        ...(state === undefined ? {} : { state }),
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    ASSIGNMENTS,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createOrgAssignment',
        tags,
        summary: 'Personeli pozisyona ata',
        description: `Kurum personel üyeliği × pozisyon, başlangıç ve isteğe bağlı bitiş günü (uçlar dahil; K-444). Pozisyon kurumda olmalı (422 \`org_assignment_position_not_found\`), birimi etkin olmalı (422 \`org_unit_inactive\`); personel kurumun etkin yönetici, öğretmen ya da ön büro üyeliği (422 \`org_assignment_staff_not_found\`, \`org_assignment_not_staff\`, \`org_assignment_staff_inactive\`). Aynı personel aynı pozisyona kesişen aralıkla 409 \`org_assignment_overlap\`; aralıkta herhangi bir gün kadro dolarsa 422 \`org_position_full\`. \`Idempotency-Key\` zorunlu. ${ROLE}`,
        headers: createHeaders,
        body: orgAssignmentInputSchema,
        response: { 201: assignmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createAssignmentCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return assignmentResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${ASSIGNMENTS}/:assignmentId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateOrgAssignment',
        tags,
        summary: 'Atamanın bitiş gününü yaz',
        description: `Atama bitirilir ya da bitişi değişir/kaldırılır (K-444). Bitiş başlangıçtan önce olamaz (422 \`org_assignment_end_before_start\`); uzatmada çakışma (409 \`org_assignment_overlap\`) ve kadro (422 \`org_position_full\`) yeniden denetlenir. Değişiklik yoksa 422 \`org_assignment_unchanged\`; kaldırılmış pozisyonun ataması 422 \`org_position_archived\`. \`If-Match\` zorunlu. Başka kurumun ataması 404. ${ROLE}`,
        headers: changeHeaders,
        params: assignmentParams,
        body: orgAssignmentUpdateSchema,
        response: { 200: assignmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateAssignmentCommand(
        contextOf(request),
        request.params.assignmentId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return assignmentResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${ASSIGNMENTS}/:assignmentId`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'archiveOrgAssignment',
        tags,
        summary: 'Yanlış atamayı kaldır',
        description: `Yanlış girilen atama arşivlenir; kadroya ve geçmişe sayılmaz (K-444). Biten görev için kaldırma değil bitiş günü kullanılır. \`If-Match\` zorunlu. Başka kurumun ya da kaldırılmış atama 404. ${ROLE}`,
        headers: changeHeaders,
        params: assignmentParams,
        response: { 200: archiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveAssignmentCommand(
        contextOf(request),
        request.params.assignmentId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return archiveResponse.parse(sendBody(reply, result))
    },
  )
}
