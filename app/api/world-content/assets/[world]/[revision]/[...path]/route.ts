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
    const upstream = await fetch(signedUrl);
    if (!upstream.ok || !upstream.body) {
      throw new Error(`World content storage returned ${upstream.status}.`);
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: responseHeaders(upstream.headers)
    });
  } catch (error) {
    if (error instanceof WorldContentNotFoundError) {
      return NextResponse.json({error: error.message}, {status: 404});
    }
    console.error('World content asset signing failed.', error);
    return NextResponse.json({error: 'World content asset is unavailable.'}, {status: 500});
  }
}

function responseHeaders(upstream: Headers): Headers {
  const headers = new Headers({
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff'
  });
  for (const name of ['content-type', 'etag', 'last-modified']) {
    const value = upstream.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}
