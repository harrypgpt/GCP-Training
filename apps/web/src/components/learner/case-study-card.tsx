import { type JSX } from 'react';

import { type LessonCaseStudyView } from '@gcp/shared';

import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Presents one case study for learning purposes: scenario, context,
 * observation, domain, risk and (where appropriate) the expected action.
 * Deliberately renders only learner-safe fields — no admin metadata, no
 * hidden exam answer keys — so the same component can be reused unchanged
 * by the future exam UI without any risk of leaking extra fields.
 */
export function CaseStudyCard({ caseStudy }: { caseStudy: LessonCaseStudyView }): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{caseStudy.title}</CardTitle>
          <div className="flex gap-2">
            {caseStudy.domain && <Badge tone="info">{caseStudy.domain.name}</Badge>}
            {caseStudy.riskCategory && <Badge tone="warning">{caseStudy.riskCategory} risk</Badge>}
          </div>
        </div>
      </CardHeader>
      <div className="space-y-3 text-sm">
        {caseStudy.context && (
          <p>
            <span className="font-medium text-foreground">Context: </span>
            <span className="text-muted-foreground">{caseStudy.context}</span>
          </p>
        )}
        <p>
          <span className="font-medium text-foreground">Scenario: </span>
          <span className="text-muted-foreground">{caseStudy.scenario}</span>
        </p>
        <p>
          <span className="font-medium text-foreground">Observation: </span>
          <span className="text-muted-foreground">{caseStudy.observation}</span>
        </p>
        {caseStudy.expectedAction && (
          <p>
            <span className="font-medium text-foreground">Expected action: </span>
            <span className="text-muted-foreground">{caseStudy.expectedAction}</span>
          </p>
        )}
      </div>
    </Card>
  );
}
