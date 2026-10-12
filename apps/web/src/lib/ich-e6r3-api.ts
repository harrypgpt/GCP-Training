import {
  LEARNER_ICH_E6R3_ROUTES,
  ichE6R3OverviewSchema,
  ichE6R3SectionViewSchema,
  type IchE6R3Overview,
  type IchE6R3SectionView,
} from '@gcp/shared';

import { authenticatedJson } from './auth/authenticated-fetch';

/**
 * Gate 29: the learner-facing ICH E6(R3) document reader. Every call
 * returns rendered section text for in-application display only - there
 * is no method here (and no backend endpoint) that returns a downloadable
 * file, a raw storage URL, or a signed download link (§5).
 */
export const ichE6R3Api = {
  getOverview(): Promise<IchE6R3Overview> {
    return authenticatedJson(LEARNER_ICH_E6R3_ROUTES.overview, ichE6R3OverviewSchema);
  },

  /**
   * Reading this endpoint IS how progress advances - there is no separate
   * "mark as viewed" call. Fetching a later section always records the
   * furthest position reached.
   */
  getSection(sequence: number): Promise<IchE6R3SectionView> {
    return authenticatedJson(LEARNER_ICH_E6R3_ROUTES.section(sequence), ichE6R3SectionViewSchema);
  },
};
