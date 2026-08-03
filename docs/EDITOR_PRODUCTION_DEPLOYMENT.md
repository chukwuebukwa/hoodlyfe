# Level Editor Production Deployment

## Current preview deployment

The existing `hoodlyfe game` Railway service can serve `/editor` through the
same production Next server as the game. Set these service variables:

```text
EDITOR_PRODUCTION_ENABLED=1
EDITOR_PLAYTEST_SECRET=<long random signing secret>
EDITOR_AUTH_USER=<author username>
EDITOR_AUTH_PASSWORD=<long random password>
```

The production proxy exposes `/editor`, `/explore`, `/playtest`, and `/api/editor/*` only after
HTTP Basic authentication. Enabling the editor without both credential variables fails closed with
HTTP 503; missing or incorrect credentials return HTTP 401.
Repository-backed BIL assets
are available immediately. Locally converted WIL/STE packages are ignored by
Git and are therefore not included in a normal Git deployment.

## Railway Bucket phase

Railway Buckets are private S3-compatible object storage. Create a bucket in
the same Railway environment and auto-inject its AWS-compatible credentials
into the editor service:

```text
AWS_ENDPOINT_URL
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET_NAME
AWS_DEFAULT_REGION=auto
AWS_S3_URL_STYLE=virtual
```

The server already exposes editor endpoints for cloud drafts, immutable
published level revisions, catalog discovery, and presigned district asset
downloads under `/api/editor/*`. The next storage milestone is the district
upload CLI and editor cloud-save/publish controls.

The combined production server accepts JSON editor documents up to 2 MB. Current
256x256 BIL documents are approximately 266 KB, so this leaves room for authored
entities while retaining a bounded request-body limit.

Use presigned redirects for district package reads. This sends large map and
texture files directly from the bucket instead of through the game process.
Do not mount a Railway Volume for district assets: volumes prevent horizontal
replicas and are not available during image builds.

## Final service split

Once cloud publishing is active, deploy the same repository as a separate
`hoodlyfe editor` service. Keep the authoritative Colyseus room on
`hoodlyfe game`; editor file traffic and validation must not share its event
loop. Put the editor custom domain behind Cloudflare Access in addition to the
application credential gate.
