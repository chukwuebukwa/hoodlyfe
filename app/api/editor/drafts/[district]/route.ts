import {NextRequest, NextResponse} from 'next/server';
import {isLevelEditorDocument} from '../../../../../src/tools/level-editor/level-document.ts';
import {
  EditorStorageError,
  readEditorDraft,
  writeEditorDraft
} from '../../../../../server/editor/editor-object-store.ts';

export const dynamic = 'force-dynamic';
const MAX_DRAFT_BYTES = 8 * 1024 * 1024;

export async function GET(
  _request: NextRequest,
  context: {params: Promise<{district: string}>}
): Promise<NextResponse> {
  try {
    const {district} = await context.params;
    const draft = await readEditorDraft(district);
    if (!draft) return NextResponse.json({error: 'No cloud draft exists.'}, {status: 404});
    return NextResponse.json(draft, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    return storageErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  context: {params: Promise<{district: string}>}
): Promise<NextResponse> {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_DRAFT_BYTES) return NextResponse.json({error: 'Draft exceeds the 8 MB limit.'}, {status: 413});
    const {district} = await context.params;
    const document = await request.json() as unknown;
    if (!isLevelEditorDocument(document)) return NextResponse.json({error: 'Invalid level editor document.'}, {status: 400});
    const draft = await writeEditorDraft(district, document, editorActor(request));
    return NextResponse.json(draft, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    return storageErrorResponse(error);
  }
}

function editorActor(request: NextRequest): string {
  return request.headers.get('x-editor-actor') ?? 'unknown-editor';
}

function storageErrorResponse(error: unknown): NextResponse {
  if (error instanceof EditorStorageError) return NextResponse.json({error: error.message}, {status: error.status});
  console.error('Editor draft storage failed.', error);
  return NextResponse.json({error: 'Editor draft storage failed.'}, {status: 500});
}
