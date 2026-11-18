import {
  FINANCE_PAY_RATE_ROLES,
  severancePaySuggestion,
} from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  severanceEstimate,
  severanceParametersOn,
  severancePaySource,
  severanceWarningCodes,
  type SeveranceRequest,
} from '@kampus/school-core/lib/finance-severance.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import { listPayrollParameterSets } from '../db/finance-payroll-parameters.ts'
import { ForbiddenError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { loadAuditedStaffPayRates, payRateView } from './finance-pay-rates.ts'

/**
 * Kıdem ve ihbar tazminatı tahmini (DOM-FIN-094; ON-205, ON-341). Hesap core'dadır; servis kurumun
 * bordro parametre setlerini okuyup çıkış gününün tavan, dilim ve damga oranını çözer (K-344) ve
 * personel seçildiyse ücret tanımını denetimli okur (K-345…K-347). Hiçbir şey yazılmaz; tek yazma
 * ücret okumasının denetim satırıdır. Sonuç saklanmaz, gövde ve tutar loglanmaz (K-273).
 */

/** Ücret okuması yalnız `FINANCE_PAY_RATE_ROLES` (K-347); hesaplayıcı rolü genişlese de daralmaz. */
function assertPayReader(ctx: ServiceContext) {
  if (!(FINANCE_PAY_RATE_ROLES as readonly string[]).includes(ctx.actor.role))
    throw new ForbiddenError()
}

/**
 * Çıkış gününde personelin ücret önerisi (K-345): aylık brüt ana ücret ve nakdi yan hakların
 * toplamı; net, saatlik ya da ders saati ücretinde ve tanım yoksa öneri yok, durum nedenini verir.
 * Okuma `finance.pay_rate.read` denetimine düşer; personel değilse ya da başka kurumdansa 404.
 */
export async function severancePaySuggestionFor(
  ctx: ServiceContext,
  membershipId: string,
  date: string | undefined,
) {
  assertPayReader(ctx)
  const day = date ?? dayKey(ctx.now)
  const today = dayKey(ctx.now)
  return ctx.db.transaction(async (tx) => {
    const { member, rates } = await loadAuditedStaffPayRates(tx, ctx, membershipId)
    const suggestion = severancePaySuggestion(rates, day)
    return {
      membershipId: member.membershipId,
      name: member.name,
      active: member.active,
      date: day,
      status: suggestion.status,
      grossWageCents: suggestion.grossWageCents,
      regularBenefitsCents: suggestion.regularBenefitsCents,
      wage: suggestion.wage === null ? null : payRateView(suggestion.wage, today),
      benefits: suggestion.benefits.map((item) => ({
        ...payRateView(item.rate, today),
        included: item.included,
      })),
    }
  })
}

/**
 * Tahmin: tavan, dilim ve damga oranı kurumun çıkış günündeki setinden (K-344). `membershipId`
 * verilirse öneri çıkış günü için sunucuda yeniden okunur ve kaynağı yanıtta döner (K-346).
 */
export async function estimateSeveranceFor(ctx: ServiceContext, request: SeveranceRequest) {
  if (request.membershipId !== null) assertPayReader(ctx)
  return ctx.db.transaction(async (tx) => {
    const sets = await listPayrollParameterSets(tx, ctx.institutionId)
    const parameters = severanceParametersOn(request.endDate, sets)
    let paySource = null
    if (request.membershipId !== null) {
      const { rates } = await loadAuditedStaffPayRates(tx, ctx, request.membershipId)
      paySource = severancePaySource(
        request.membershipId,
        request.endDate,
        severancePaySuggestion(rates, request.endDate),
        request,
      )
    }
    const estimate = severanceEstimate(request, { parameters, paySource })
    return { ...estimate, warnings: severanceWarningCodes(estimate) }
  })
}
