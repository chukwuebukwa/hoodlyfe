import {NextRequest, NextResponse} from 'next/server';
import {
  BuildingPublicationError,
  publishBuildingDraft
} from '../../../../../server/world-content/building-publication.ts';
import {
  EditorRequestBodyError,
  readEditorJsonBody
} from '../../../../../server/editor/editor-request-body.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_DRAFT_BYTES = 128 * 1024;

export async function POST(
  request: NextRequest,
  context: {params: Promise<{world: string}>}
): Promise<NextResponse> {
  try {
    const {world} = await context.params;
    const draft = await readEditorJsonBody(request, MAX_DRAFT_BYTES);
    const result = await publishBuildingDraft(
      world,
      draft,
      request.headers.get('x-editor-actor') ?? 'unknown-editor'
    );
    return NextResponse.json(result, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    if (error instanceof EditorRequestBodyError) {
      return NextResponse.json({error: error.message}, {status: error.status});
    }
    if (error instanceof BuildingPublicationError) {
      return NextResponse.json({error: error.message}, {status: error.status});
    }
    console.error('Builder Gun publication failed.', error);
    return NextResponse.json({error: error instanceof Error ? error.message : 'Building publication failed.'}, {status: 500});
  }
}
