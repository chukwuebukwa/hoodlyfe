import {NextRequest, NextResponse} from 'next/server';
import {isLevelEditorDocument} from '../../../../../src/tools/level-editor/level-document.ts';
import {
  EditorStorageError,
  publishEditorRevision
} from '../../../../../server/editor/editor-object-store.ts';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: {params: Promise<{district: string}>}
): Promise<NextResponse> {
  try {
    const {district} = await context.params;
    const document = await request.json() as unknown;
    if (!isLevelEditorDocument(document)) return NextResponse.json({error: 'Invalid level editor document.'}, {status: 400});
    const result = await publishEditorRevision(
      district,
      document,
      request.headers.get('x-editor-actor') ?? 'unknown-editor'
    );
    return NextResponse.json(result, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    if (error instanceof EditorStorageError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error('Editor revision publish failed.', error);
    return NextResponse.json({error: 'Editor revision publish failed.'}, {status: 500});
  }
}
