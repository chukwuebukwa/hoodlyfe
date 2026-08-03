import {NextRequest, NextResponse} from 'next/server';
import {
  signedWorldContentAssetUrl,
  WorldContentNotFoundError
} from '../../../../../../../server/world-content/world-content-assets.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: {params: Promise<{world: string; revision: string; path: string[]}>}
): Promise<NextResponse> {
  try {
    const {world, revision, path} = await context.params;
    const signedUrl = await signedWorldContentAssetUrl(world, revision, path.join('/'));
    return NextResponse.redirect(signedUrl, {
      status: 307,
      headers: {'Cache-Control': 'private, max-age=300'}
    });
  } catch (error) {
    if (error instanceof WorldContentNotFoundError) {
      return NextResponse.json({error: error.message}, {status: 404});
    }
    console.error('World content asset signing failed.', error);
    return NextResponse.json({error: 'World content asset is unavailable.'}, {status: 500});
  }
}
