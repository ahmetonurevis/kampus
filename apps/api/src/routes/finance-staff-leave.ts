import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_STAFF_LEAVE_ROLES,
  leaveProfileSchema,
  leaveProfileUpdateSchema,
  leaveRecordCancelSchema,
  leaveRecordSchema,
  leaveTypeCreateSchema,
  leaveTypeUpdateSchema,
} from '@kampus/school-core/lib/finance-staff-leave.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelLeaveRecordCommand,
  createLeaveProfileCommand,
  createLeaveRecordCommand,
  createLeaveTypeCommand,
  getLeaveStaffFor,
  listLeaveStaffFor,
  listLeaveTypesFor,
  updateLeaveProfileCommand,
  updateLeaveTypeCommand,
} from '../services/finance-staff-leave.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  leaveProfileResponse,
  leaveRecordCancelResponse,
  leaveRecordParams,
  leaveRecordResponse,
  leaveStaffDetailQuery,
  leaveStaffDetailResponse,
  leaveStaffListQuery,
  leaveStaffListResponse,
  leaveStaffParams,
  leaveTypeListResponse,
  leaveTypeParams,
  leaveTypeResponse,
} from './finance-staff-leave.schemas.ts'

/**
 * Personel izin uçları (docs/domain/finans.md DOM-FIN-109; ON-181). Modül `finance`; okuma ve
 * yazma yalnız yönetici. Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem. Tür ayarı,
 * izin profili (kıdem başlangıcı), kullanılmış izin kaydı ve gerekçeli iptali; talep ve onay
 * akışı ON-182'dedir.
 */

const MANAGER = 'Rol: yalnız `yonetici` (personel kişisel verisi). Modül `finance`.'
const TYPES = '/api/v1/finance/leave-types'
const STAFF = '/api/v1/finance/leave-staff'
const PROFILES = '/api/v1/finance/leave-profiles'
const RECORDS = '/api/v1/finance/leave-records'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceStaffLeaveRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_STAFF_LEAVE_ROLES),
  ]
  const tags = ['finance-staff-leave']

  typed.get(
    TYPES,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listLeaveTypes',
        tags,
        summary: 'İzin türleri',
        description: `Kurumda geçerli izin türleri: platform varsayılanları (yıllık, 4857 Ek md. 2 mazeret izinleri, ücretsiz, rapor, diğer) kurum ayarı uygulanmış olarak, sonra kurumun ek türleri. \`locked\` kurumun değiştiremeyeceği alanları, \`statutoryMinDays\` yasal en az günü verir (K-361). ${MANAGER}`,
        response: { 200: leaveTypeListResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listLeaveTypesFor(contextOf(request)) }),
  )

  typed.post(
    TYPES,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createLeaveType',
        tags,
        summary: 'Ek izin türü aç',
        description: `Kurumun ek türü: mazeret, ücretsiz ya da diğer biçimde; ad, ücretli mi, yıllık izinden düşer mi, isteğe bağlı varsayılan gün. Ad kurumda tekil (422 \`leave_type_label_exists\`), ücretsiz izin ücretli olamaz (422 \`leave_type_locked\`), en çok 30 ek tür (422 \`leave_type_limit\`). \`Idempotency-Key\` isteğe bağlı. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: leaveTypeCreateSchema,
        response: { 201: leaveTypeResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createLeaveTypeCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return leaveTypeResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${TYPES}/:code`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateLeaveType',
        tags,
        summary: 'İzin türünü ayarla',
        description: `Ad, ücretli mi, yıllık izinden düşer mi, varsayılan gün ve etkinlik (kısmi). Kilitli alan (yıllık izin ücretli ve yıllıktan düşer, kapatılamaz; mazeret izni ücretli ve yıllıktan düşmez; ücretsiz izin ücretsiz; rapor yıllıktan düşmez ve kapatılamaz) 422 \`leave_type_locked\`; yasal mazerette varsayılan gün yasal en azın altına inmez (422 \`leave_type_days_below_statutory\`); değişiklik yoksa 422 \`leave_type_unchanged\`. Ayar geçmiş kayıtları değiştirmez (kayıt tür kopyasını taşır). \`If-Match\` zorunlu: ayarı hiç yazılmamış varsayılan türde \`"1"\`. Olmayan tür 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: leaveTypeParams,
        body: leaveTypeUpdateSchema,
        response: { 200: leaveTypeResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateLeaveTypeCommand(
        contextOf(request),
        request.params.code,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return leaveTypeResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    STAFF,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listLeaveStaff',
        tags,
        summary: 'Personel ve yıllık izin özeti',
        description: `Kurumun yönetici, öğretmen ve ön büro üyelikleri ada göre; her satırda kıdem başlangıcı ve \`date\` günündeki (varsayılan bugün) hizmet yılı, son ve sonraki hak ediş, hak edilen, kullanılan, devreden ve kalan yıllık izin (DOM-FIN-109, K-360). Kıdem başlangıcı girilmemiş personelde özet boştur. Pasif (ayrılan) personel de listelenir; hizmeti pasifleştirilme gününde biter. ${MANAGER}`,
        querystring: leaveStaffListQuery,
        response: { 200: leaveStaffListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, date } = request.query
      const { items, total } = await listLeaveStaffFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        day: date,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${STAFF}/:membershipId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getLeaveStaff',
        tags,
        summary: 'Personelin izin bilgisi ve hak edişi',
        description: `İzin profili (kıdem başlangıcı, doğum günü, açılış devri), \`date\` gününe göre yıl yıl hak ediş dökümü ve bakiye (devreden, bu yılın hakkı, kullanılan, planlanan, kalan), iptal edilmemiş kullanılmış izin kayıtları. Olmayan, başka kurumun ya da personel olmayan (öğrenci, veli) üyelik 404. ${MANAGER}`,
        params: leaveStaffParams,
        querystring: leaveStaffDetailQuery,
        response: { 200: leaveStaffDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getLeaveStaffFor(
        contextOf(request),
        request.params.membershipId,
        request.query.date,
      ),
    }),
  )

  typed.post(
    PROFILES,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createLeaveProfile',
        tags,
        summary: 'İzin profili aç',
        description: `Personelin kıdem başlangıcı (işe giriş günü; personel kaydında olmadığı için elle), isteğe bağlı doğum günü (18 yaş altı ve 50 yaş ve üstü kuralı) ve açılış devri (sistem öncesi hak ediş ve kullanımın tek satırı). Kıdem başlangıcı 1960'tan önce ya da bugünden sonra olamaz (422 \`staff_leave_seniority_too_early\`, \`staff_leave_seniority_future\`); doğum günü işe başlarken 14 yaşını doldurmayı sağlamalı (422 \`staff_leave_birth_date_invalid\`); açılış günü kıdem başlangıcı ile bugün arasında (422 \`staff_leave_opening_date_invalid\`). Profil zaten varsa 422 \`staff_leave_profile_exists\`; olmayan üyelik 422 \`staff_leave_staff_not_found\`, öğrenci ya da veli 422 \`staff_leave_not_staff\`, pasif personel 422 \`staff_leave_staff_inactive\`. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` isteğe bağlı. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: leaveProfileSchema,
        response: { 201: leaveProfileResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createLeaveProfileCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return leaveProfileResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${PROFILES}/:membershipId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateLeaveProfile',
        tags,
        summary: 'İzin profilini düzelt',
        description: `Kıdem başlangıcı, doğum günü ya da açılış devri (kısmi; \`null\` temizler). Birleşik profil açılıştaki denetimlerden geçer; yıllık izinden düşen bir kayıt yeni kıdem başlangıcından önce kalırsa 422 \`staff_leave_before_seniority\`; değişiklik yoksa 422 \`staff_leave_profile_unchanged\`. \`If-Match\` zorunlu. Profili olmayan ya da başka kurumun personeli 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: leaveStaffParams,
        body: leaveProfileUpdateSchema,
        response: { 200: leaveProfileResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateLeaveProfileCommand(
        contextOf(request),
        request.params.membershipId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return leaveProfileResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    RECORDS,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createLeaveRecord',
        tags,
        summary: 'Kullanılmış izin kaydı yaz',
        description: `Talep ve onay akışı (ON-182) gelene kadar kullanılan izin elle yazılır: tür, ilk ve son gün (dahil), kullanılan iş günü (elle; aralığın takvim gününü aşamaz, 422 \`staff_leave_days_exceed_range\`), not (K-362). Kayıt türün ücretli ve yıllıktan düşer ayarını kopyalar. Aynı personelde çakışan kayıt 422 \`staff_leave_overlap\`; olmayan ya da kapalı tür 422 \`staff_leave_type_not_found\`, \`staff_leave_type_inactive\`; rapor elle yazılmaz (422 \`staff_leave_sick_not_manual\`; sağlık raporu kaydından okunur). Yıllık izinden düşen kayıt kıdem başlangıcı ister (422 \`staff_leave_profile_required\`) ve ondan önce başlayamaz (422 \`staff_leave_before_seniority\`). Bakiye eksiye düşebilir (avans izin). \`Idempotency-Key\` zorunlu: çift gönderim izni iki kez düşmez. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: leaveRecordSchema,
        response: { 201: leaveRecordResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createLeaveRecordCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = leaveRecordResponse.parse(sendBody(reply, result))
      reply.header('location', `${RECORDS}/${body.data.id}`)
      return body
    },
  )

  typed.post(
    `${RECORDS}/:recordId/cancel`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelLeaveRecord',
        tags,
        summary: 'Kullanılmış izin kaydını iptal et',
        description: `Yanlış kayıt gerekçeyle (5–500 karakter) iptal edilir; kayıt düzeltilmez ve iptal edilen kayıt bakiyeye sayılmaz. Gerekçe denetim kaydına yazılmaz. \`If-Match\` zorunlu. Başka kurumun ya da iptal edilmiş kayıt 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: leaveRecordParams,
        body: leaveRecordCancelSchema,
        response: { 200: leaveRecordCancelResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelLeaveRecordCommand(
        contextOf(request),
        request.params.recordId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return leaveRecordCancelResponse.parse(sendBody(reply, result))
    },
  )
}
