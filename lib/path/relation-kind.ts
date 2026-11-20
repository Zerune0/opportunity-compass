import { TEAM_RELATION, UNCLEAR_REQUIRED_RELATION } from './plan';

/**
 * The kind of reason behind a route step, read back from RouteStep.relation. planRoutes writes relation from a
 * fixed set of sentences (see lib/path/plan.ts), so each kind matches one sentence pattern exactly; anything else
 * is "other" and the full text is still shown on demand. Used for short tags in the Map's Classic table.
 */
export type RelationKind =
  | 'meets_requirement'
  | 'adds_plus'
  | 'needed_to_apply'
  | 'unclear'
  | 'builds_evidence'
  | 'team_suggestion'
  | 'application'
  | 'other';

export const relationKindLabels: Record<RelationKind, string> = {
  meets_requirement: 'Meets a requirement',
  adds_plus: 'Adds a plus',
  needed_to_apply: 'Needed to apply',
  unclear: 'Unclear, confirm',
  builds_evidence: 'Builds evidence',
  team_suggestion: 'Team suggestion',
  application: 'The application',
  other: 'Other reason',
};

export function relationKind(relation: string | null | undefined): RelationKind {
  const text = typeof relation === 'string' ? relation.trim() : '';
  if (text === '') return 'other';
  if (/^Works toward ".*", which the organizer lists as a requirement\.$/.test(text)) return 'meets_requirement';
  if (/^Works toward ".*", which the organizer lists as a plus \(not required\)\.$/.test(text)) return 'adds_plus';
  if (/^Prepares ".*", which the organizer lists as needed to apply\.$/.test(text)) return 'needed_to_apply';
  if (text === UNCLEAR_REQUIRED_RELATION) return 'unclear';
  if (/^Builds .* evidence in place of the prep item ".*"\./.test(text)) return 'builds_evidence';
  if (text === TEAM_RELATION) return 'team_suggestion';
  if (/^The application itself for .*\.$/.test(text)) return 'application';
  return 'other';
}
