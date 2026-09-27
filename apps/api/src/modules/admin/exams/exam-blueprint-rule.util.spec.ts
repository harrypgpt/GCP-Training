import {
  describeRule,
  exclusiveGroupKey,
  ruleHasNoDimension,
  ruleSignature,
  ruleToEligibilityFilter,
  type RuleDimensions,
} from './exam-blueprint-rule.util';

function baseRule(overrides: Partial<RuleDimensions> = {}): RuleDimensions {
  return {
    questionType: null,
    difficulty: null,
    domainId: null,
    professionalRoleId: null,
    levelId: null,
    learningObjectiveId: null,
    caseStudyRequired: null,
    sourceRequired: null,
    ...overrides,
  };
}

describe('exam-blueprint-rule.util', () => {
  describe('ruleToEligibilityFilter', () => {
    it('defaults to the exam version level when the rule does not override it', () => {
      const filter = ruleToEligibilityFilter(baseRule(), 'level-1');
      expect(filter).toEqual({ levelId: 'level-1' });
    });

    it('lets a rule override the level', () => {
      const filter = ruleToEligibilityFilter(baseRule({ levelId: 'level-2' }), 'level-1');
      expect(filter.levelId).toBe('level-2');
    });

    it('carries every set dimension through', () => {
      const filter = ruleToEligibilityFilter(
        baseRule({
          questionType: 'CASE_STUDY',
          difficulty: 'HARD',
          domainId: 'dom-1',
          professionalRoleId: 'role-1',
          learningObjectiveId: 'obj-1',
          caseStudyRequired: true,
          sourceRequired: true,
        }),
        'level-1',
      );
      expect(filter).toEqual({
        levelId: 'level-1',
        domainId: 'dom-1',
        professionalRoleId: 'role-1',
        questionType: 'CASE_STUDY',
        difficulty: 'HARD',
        learningObjectiveId: 'obj-1',
        caseStudyRequired: true,
        sourceRequired: true,
      });
    });

    it('omits false boolean dimensions rather than filtering them explicitly', () => {
      const filter = ruleToEligibilityFilter(
        baseRule({ caseStudyRequired: false, sourceRequired: false }),
        'level-1',
      );
      expect(filter).toEqual({ levelId: 'level-1' });
    });
  });

  describe('ruleHasNoDimension', () => {
    it('is true for a rule with no constraints at all', () => {
      expect(ruleHasNoDimension(baseRule())).toBe(true);
    });

    it('is false once any single dimension is set', () => {
      expect(ruleHasNoDimension(baseRule({ questionType: 'KNOWLEDGE' }))).toBe(false);
      expect(ruleHasNoDimension(baseRule({ caseStudyRequired: true }))).toBe(false);
    });
  });

  describe('ruleSignature', () => {
    it('is identical for two rules with the same dimensions', () => {
      const a = baseRule({ questionType: 'CASE_STUDY', difficulty: 'HARD' });
      const b = baseRule({ questionType: 'CASE_STUDY', difficulty: 'HARD' });
      expect(ruleSignature(a)).toBe(ruleSignature(b));
    });

    it('differs when any dimension differs', () => {
      const a = baseRule({ questionType: 'CASE_STUDY' });
      const b = baseRule({ questionType: 'SCENARIO' });
      expect(ruleSignature(a)).not.toBe(ruleSignature(b));
    });
  });

  describe('exclusiveGroupKey', () => {
    it('groups a rule whose sole dimension is questionType', () => {
      expect(exclusiveGroupKey(baseRule({ questionType: 'CASE_STUDY' }))).toBe(
        'questionType:CASE_STUDY',
      );
    });

    it('does not group a rule combining questionType with another dimension', () => {
      expect(
        exclusiveGroupKey(baseRule({ questionType: 'CASE_STUDY', difficulty: 'HARD' })),
      ).toBeNull();
    });

    it('does not group a rule with no questionType at all', () => {
      expect(exclusiveGroupKey(baseRule({ difficulty: 'HARD' }))).toBeNull();
    });
  });

  describe('describeRule', () => {
    it('describes a rule with no dimensions', () => {
      expect(describeRule(baseRule())).toBe('(no dimension constraint)');
    });

    it('joins every set dimension', () => {
      const desc = describeRule(baseRule({ questionType: 'CASE_STUDY', caseStudyRequired: true }));
      expect(desc).toContain('type=CASE_STUDY');
      expect(desc).toContain('caseStudyRequired');
    });
  });
});
