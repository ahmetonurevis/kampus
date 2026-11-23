import { z } from 'zod'

import { PURCHASE_APPROVER_ROLES } from '@kampus/school-core/lib/finance-purchase-approvals.ts'

import { dataResponse } from './common.schemas.ts'

/** Kademeli onay ayarı şemaları (DOM-FIN-071; ON-223, K-260). */

export const purchaseApprovalSettingsResponse = dataResponse(
  z
    .object({
      tiers: z
        .array(
          z.object({
            position: z.number().int().describe('Kademe sırası, 1’den'),
            minTotalCents: z
              .number()
              .int()
              .describe(
                'Alt sınır: talebin KDV dahil tahmini toplamı bu tutara eşit ya da büyükse kademe gerekir, kuruş',
              ),
            approverRole: z
              .enum(PURCHASE_APPROVER_ROLES)
              .nullable()
              .describe('Onaylayan rol (herhangi bir yönetici); adlandırılmış kişi varsa boş'),
            approverUserId: z.string().nullable().describe('Adlandırılmış onaylayan'),
            approverName: z.string().nullable(),
            approverEligible: z
              .boolean()
              .describe(
                'Adlandırılmış kişi hâlâ kurumun etkin yöneticisi mi; değilse ayar yeniden kaydedilemez',
              ),
          }),
        )
        .describe('Kademeler; boşsa talepleri her yönetici tek adımda onaylar (K-129)'),
      approvers: z
        .array(z.object({ userId: z.string(), name: z.string() }))
        .describe('Adlandırılabilecek kişiler: kurumun etkin yöneticileri'),
      version: z.number().int().describe('`If-Match` için ayar sürümü; ayar hiç kaydedilmediyse 1'),
    })
    .describe('Satın alma talebi kademeli onay ayarı'),
)
