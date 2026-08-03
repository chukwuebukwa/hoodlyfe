import {NextRequest, NextResponse} from 'next/server';
import {evaluateEditorAccess} from './server/editor/editor-access-policy.ts';

export function proxy(request: NextRequest): NextResponse {
  const decision = evaluateEditorAccess(request.headers.get('authorization'), process.env);
  if (!decision.allowed) {
    const response = new NextResponse(decision.reason, {status: decision.status});
    response.headers.set('Cache-Control', 'no-store');
    if (decision.status === 401) response.headers.set('WWW-Authenticate', 'Basic realm="Hoodlyfe Authoring"');
    return response;
  }
  const headers = new Headers(request.headers);
  headers.set('x-editor-actor', decision.actor);
  return NextResponse.next({request: {headers}});
}

export const config = {
  matcher: ['/editor/:path*', '/explore/:path*', '/playtest/:path*', '/api/editor/:path*']
};
