import {NextResponse} from 'next/server';
import type {EditorCatalogResponse} from '../../../../shared/content/editor-production.ts';
import {bucketDistrictIds, editorStorageEnabled} from '../../../../server/editor/editor-object-store.ts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<EditorCatalogResponse>> {
  const storageEnabled = editorStorageEnabled();
  return NextResponse.json({
    storageEnabled,
    bucketDistrictIds: storageEnabled ? await bucketDistrictIds() : []
  }, {headers: {'Cache-Control': 'no-store'}});
}
