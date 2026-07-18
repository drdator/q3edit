#!/usr/bin/env bash

set -euo pipefail

readonly SITE_DOMAIN="${Q3EDIT_DOMAIN:-q3edit.com}"

if [[ ! "$SITE_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Error: Q3EDIT_DOMAIN contains unsupported characters." >&2
  exit 1
fi

for command_name in npm aws; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: '$command_name' is required but was not found." >&2
    exit 1
  fi
done

aws_account_id="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
if [[ -z "$aws_account_id" || "$aws_account_id" == "None" ]]; then
  echo "Error: AWS authentication is missing or expired." >&2
  echo "Sign in or refresh your AWS credentials, then run this script again." >&2
  exit 1
fi

bucket_prefix="${SITE_DOMAIN//./-}"
readonly S3_BUCKET="${Q3EDIT_S3_BUCKET:-${bucket_prefix}-${aws_account_id}}"

cloudfront_distribution_id="${Q3EDIT_CLOUDFRONT_DISTRIBUTION_ID:-}"
if [[ -z "$cloudfront_distribution_id" ]]; then
  cloudfront_distribution_id="$(
    aws cloudfront list-distributions \
      --query "DistributionList.Items[?Aliases.Quantity > \`0\` && contains(Aliases.Items, '${SITE_DOMAIN}')].Id | [0]" \
      --output text
  )"
fi

if [[ -z "$cloudfront_distribution_id" || "$cloudfront_distribution_id" == "None" ]]; then
  echo "Error: no CloudFront distribution found for ${SITE_DOMAIN}." >&2
  echo "Set Q3EDIT_CLOUDFRONT_DISTRIBUTION_ID to override discovery." >&2
  exit 1
fi
readonly CLOUDFRONT_DISTRIBUTION_ID="$cloudfront_distribution_id"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "${script_dir}/../.." && pwd)"
cd "$project_dir"

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
npm run build:release
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
echo "Site: https://${SITE_DOMAIN}"
