#!/usr/bin/env bash

set -euo pipefail

readonly S3_BUCKET="q3edit-com-example"
readonly CLOUDFRONT_DISTRIBUTION_ID="E24BUKRVFXR5GJ"

for command_name in npm aws; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: '$command_name' is required but was not found." >&2
    exit 1
  fi
done

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "Error: AWS authentication is missing or expired." >&2
  echo "Sign in or refresh your AWS credentials, then run this script again." >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

for asset_path in \
  public/openarena/manifest.json \
  public/openarena/COPYING \
  public/openarena/OPENARENA.md \
  public/openarena/pak0.pk3 \
  public/openarena/pak4-textures.pk3; do
  if [[ ! -f "$asset_path" ]]; then
    echo "Error: required OpenArena asset '$asset_path' is missing." >&2
    echo "Run 'npm run assets:openarena' before deploying." >&2
    exit 1
  fi
done

echo "Building Q3Edit..."
npm run build
find dist -type f -name ".DS_Store" -delete

echo "Uploading dist/ to s3://${S3_BUCKET}/..."
aws s3 sync dist/ "s3://${S3_BUCKET}/" \
  --delete \
  --exclude ".DS_Store" \
  --exclude "*/.DS_Store"

echo "Invalidating CloudFront cache..."
invalidation_id="$(
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --paths "/*" \
    --query 'Invalidation.Id' \
    --output text
)"

echo "Deployment uploaded successfully."
echo "CloudFront invalidation: ${invalidation_id}"
echo "Site: https://q3edit.com"
