import {NextRequest, NextResponse} from 'next/server';
import type {EditorPlaytestResponse} from '../../../../../shared/content/editor-production.ts';
import {isLevelEditorDocument} from '../../../../../src/tools/level-editor/level-document.ts';
import {
  EditorStorageError,
  storeEditorPlaytestRevision
} from '../../../../../server/editor/editor-object-store.ts';
import {issuePlaytestTicket} from '../../../../../server/editor/playtest-ticket.ts';
import {compilePlaytestWorld} from '../../../../../server/editor/playtest-world-loader.ts';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: {params: Promise<{district: string}>}
): Promise<NextResponse> {
  try {
    const {district} = await context.params;
    const document = await request.json() as unknown;
    if (!isLevelEditorDocument(document)) {
      return NextResponse.json({error: 'Invalid level editor document.'}, {status: 400});
    }
    const preflight = compilePlaytestWorld(district, 'preflight', document);
    const stored = await storeEditorPlaytestRevision(
      district,
      document,
      request.headers.get('x-editor-actor') ?? 'unknown-editor'
    );
    const token = issuePlaytestTicket(district, stored.revision.revision);
    const query = new URLSearchParams({
      district,
      revision: stored.revision.revision,
      token
    });
    if (preflight.warnings.length > 0) query.set('laneFallback', '1');
    const response: EditorPlaytestResponse = {
      ...stored,
      roomName: 'district-playtest',
      token,
      playUrl: `/playtest?${query}`,
      warnings: preflight.warnings
    };
    return NextResponse.json(response, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    if (error instanceof EditorStorageError) {
      return NextResponse.json({error: error.message}, {status: error.status});
    }
    console.error('Authoritative Play Draft creation failed.', error);
    return NextResponse.json({error: 'Authoritative Play Draft creation failed.'}, {status: 500});
  }
}
