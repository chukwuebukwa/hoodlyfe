# Level Editor Production Deployment

## Current preview deployment

The existing `hoodlyfe game` Railway service can serve `/editor` through the
same production Next server as the game. Set these service variables:

```text
EDITOR_PRODUCTION_ENABLED=1
EDITOR_AUTH_USER=<private username>
EDITOR_AUTH_PASSWORD=<long random password>
```

The production proxy protects `/editor`, `/explore`, and `/api/editor/*` with
HTTP Basic Auth. Local development remains open. Repository-backed BIL assets
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

The server already exposes protected endpoints for cloud drafts, immutable
published level revisions, catalog discovery, and presigned district asset
downloads under `/api/editor/*`. The next storage milestone is the district
upload CLI and editor cloud-save/publish controls.

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
