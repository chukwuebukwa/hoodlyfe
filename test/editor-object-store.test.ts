import assert from 'node:assert/strict';
import test from 'node:test';
import {
  districtAssetManifestKey,
  districtDraftKey,
  districtPublishedKey,
  districtRevisionKey,
  resolveEditorBucketConfig
} from '../server/editor/editor-object-store.ts';

test('Railway bucket variables resolve through AWS-compatible names', () => {
  assert.deepEqual(resolveEditorBucketConfig({
    AWS_ENDPOINT_URL: 'https://storage.railway.app',
    AWS_ACCESS_KEY_ID: 'access',
    AWS_SECRET_ACCESS_KEY: 'secret',
    AWS_S3_BUCKET_NAME: 'hoodlyfe-editor-abc123',
    AWS_DEFAULT_REGION: 'auto',
    AWS_S3_URL_STYLE: 'virtual'
  }), {
    endpoint: 'https://storage.railway.app',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    bucket: 'hoodlyfe-editor-abc123',
    region: 'auto',
    forcePathStyle: false
  });
});

test('editor object keys isolate drafts, revisions, publishes, and district assets', () => {
  assert.equal(districtDraftKey('wil'), 'editor/drafts/wil/latest.json');
  assert.equal(districtRevisionKey('wil', '0123456789ab'), 'editor/revisions/wil/0123456789ab.level.json');
  assert.equal(districtPublishedKey('wil'), 'editor/published/wil/current.json');
  assert.equal(districtAssetManifestKey('wil'), 'districts/wil/current.json');
  assert.throws(() => districtDraftKey('../wil'), /Unknown district/);
});
