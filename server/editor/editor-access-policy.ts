export interface EditorAccessEnvironment {
  NODE_ENV?: string;
  EDITOR_ONLY_SERVICE?: string;
  EDITOR_PRODUCTION_ENABLED?: string;
}

export type EditorAccessDecision =
  | {allowed: true; actor: string}
  | {allowed: false; status: 401 | 404 | 503; reason: string};

export function evaluateEditorAccess(
  authorization: string | null,
  environment: EditorAccessEnvironment
): EditorAccessDecision {
  if (environment.NODE_ENV !== 'production') return {allowed: true, actor: 'local-developer'};
  const enabled = environment.EDITOR_ONLY_SERVICE === '1' || environment.EDITOR_PRODUCTION_ENABLED === '1';
  if (!enabled) return {allowed: false, status: 404, reason: 'Editor is not enabled on this service.'};
  void authorization;
  return {allowed: true, actor: 'public-editor'};
}
