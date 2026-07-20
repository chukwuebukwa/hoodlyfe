const DEFAULT_EDITOR_BODY_LIMIT = 2 * 1024 * 1024;

export class EditorRequestBodyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function readEditorJsonBody(
  request: Pick<Request, 'body' | 'headers'>,
  maxBytes = DEFAULT_EDITOR_BODY_LIMIT
): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new EditorRequestBodyError(413, 'Editor document exceeds the 2 MB request limit.');
  }
  if (!request.body) throw new EditorRequestBodyError(400, 'Editor document body is required.');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new EditorRequestBodyError(413, 'Editor document exceeds the 2 MB request limit.');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new EditorRequestBodyError(400, 'Editor document body is not valid JSON.');
  }
}
