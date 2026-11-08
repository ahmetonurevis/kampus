import { eq } from 'drizzle-orm'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  DEFAULT_YEAR_START,
  defaultOpeningYear,
  openingWatch,
  openingWindow,
  type OpeningWatch,
  type OpeningWatchQuery,
} from '@kampus/school-core/lib/finance-opening-watch.ts'

import { loadAcademicYears } from '../db/academic-years.ts'
import { allocatedTotals } from '../db/payments.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import { withdrawalsForOpeningWatch } from '../db/withdrawals.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'
import { FINANCE_TABLE_STORES, runReadOnly } from './operation-runner.ts'

/**
 * Açılış nöbeti (`GET /finance/opening-watch`; DOM-FIN-061, ON-095). Taksit ve sözleşme tablolardan
 * (ADR 0010), öğrenci, sınıf ve yenileme kayıtlardan, ayrılış ve tahsilat dağılımı kendi
 * tablolarından tek salt okunur görüntüde okunur. Kurum yalnız oturumdan gelir; satır loglanmaz.
 * Yenileme modülü kapalıysa (kursta hiç yoktur) yenileme kaydı okunmuş sayılmaz: geçiş olayları
 * boş kalır, yanıt bunu `renewalModule` ile söyler.
 */
export function openingWatchFor(
  ctx: ServiceContext,
  query: OpeningWatchQuery,
): Promise<OpeningWatch & { renewalModule: boolean; terms: OpeningTermRow[] }> {
  const today = dayKey(ctx.now)
  return runReadOnly(ctx, {
    action: 'finance.opening_watch',
    collections: ['students', 'classes', 'invoices', 'contracts', 'renewals'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const [allocated, withdrawals, years, institution, settings] = [
        await allocatedTotals(tx, ctx.institutionId),
        await withdrawalsForOpeningWatch(tx, ctx.institutionId),
        await loadAcademicYears(tx, ctx.institutionId),
        await getInstitutionModules(tx, ctx.institutionId),
        await tx
          .select({ academicYear: institutionSettings.academicYear })
          .from(institutionSettings)
          .where(eq(institutionSettings.institutionId, ctx.institutionId))
          .limit(1),
      ]
      const renewalModule = institution?.modules.renewal === true
      const academicYear =
        query.academicYear ??
        defaultOpeningYear({
          settingsYear: settings[0]?.academicYear ?? null,
          activeYear: years.find((year) => year.status === 'active')?.startYear ?? null,
          today,
        })
      const year = years.find((item) => item.startYear === academicYear)
      const terms = (year?.terms ?? [])
        .map(({ id, name, startDate, endDate }) => ({ id, name, startDate, endDate }))
        .sort((left, right) => left.startDate.localeCompare(right.startDate))
      return {
        run: (state) => {
          // İşlem içinde denetlenir: DomainError yalnız burada 422'ye çevrilir.
          const window = openingWindow({
            yearStartDate: year?.startDate ?? `${String(academicYear)}-${DEFAULT_YEAR_START}`,
            terms,
            query,
          })
          return {
            ...openingWatch({
              academicYear,
              today,
              window,
              students: state.students,
              classes: state.classes,
              invoices: state.invoices,
              contracts: state.contracts,
              allocated,
              renewals: renewalModule ? state.renewals : [],
              withdrawals,
            }),
            renewalModule,
            terms,
          }
        },
      }
    },
  })
}

export interface OpeningTermRow {
  id: string
  name: string
  startDate: string
  endDate: string
}
