import {NextRequest, NextResponse} from 'next/server';
import {
  EditorStorageError,
  signedDistrictAssetUrl
} from '../../../../../../server/editor/editor-object-store.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: {params: Promise<{district: string; path: string[]}>}
): Promise<NextResponse> {
  try {
    const {district, path} = await context.params;
    const signedUrl = await signedDistrictAssetUrl(district, path.join('/'));
    return NextResponse.redirect(signedUrl, {status: 307, headers: {'Cache-Control': 'private, max-age=300'}});
  } catch (error) {
    if (error instanceof EditorStorageError) return NextResponse.json({error: error.message}, {status: error.status});
    console.error('District asset signing failed.', error);
    return NextResponse.json({error: 'District asset is unavailable.'}, {status: 500});
  }
}
