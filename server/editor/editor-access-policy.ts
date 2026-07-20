export interface EditorAccessEnvironment {
  NODE_ENV?: string;
  EDITOR_ONLY_SERVICE?: string;
  EDITOR_PRODUCTION_ENABLED?: string;
  EDITOR_AUTH_USER?: string;
  EDITOR_AUTH_PASSWORD?: string;
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
  const expectedUser = environment.EDITOR_AUTH_USER?.trim();
  const expectedPassword = environment.EDITOR_AUTH_PASSWORD;
  if (!expectedUser || !expectedPassword) {
    return {allowed: false, status: 503, reason: 'Editor access credentials are not configured.'};
  }
  const credentials = decodeBasicAuthorization(authorization);
  if (!credentials || credentials.user !== expectedUser || credentials.password !== expectedPassword) {
    return {allowed: false, status: 401, reason: 'Editor authentication required.'};
  }
  return {allowed: true, actor: credentials.user};
}

function decodeBasicAuthorization(value: string | null): {user: string; password: string} | undefined {
  if (!value?.startsWith('Basic ')) return undefined;
  try {
    const decoded = atob(value.slice(6));
    const separator = decoded.indexOf(':');
    if (separator < 0) return undefined;
    return {user: decoded.slice(0, separator), password: decoded.slice(separator + 1)};
  } catch {
    return undefined;
  }
}
