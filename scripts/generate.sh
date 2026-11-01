#!/usr/bin/env sh
# Regenerates src/generated/ from the API's production OpenAPI document.
#
#   sh scripts/generate.sh [openapi.json]     (default: downloads https://api.aureahub.com/v1/docs/json)
#
# Generator: openapi-generator 7.25.0, typescript-fetch, with the options the aurea_api CI job openapi-generate
# uses (scripts/openapi-clients.sh there): --skip-validate-spec and KEEP_ONLY_FIRST_TAG_IN_OPERATION, supportsES6.
# GENERATOR_JAR: the generator's jar (openapi-generator-cli-7.25.0.jar from Maven Central, sha1
# 56a9bb79e3bb565f477eddca2c6daa288a9c6f35); Java 11 or later.
#
# Only the operations docs.aureahub.com documents are generated (spec/operations.json; scripts/filter-spec.mjs).
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
GENERATOR_JAR=${GENERATOR_JAR:?set GENERATOR_JAR to openapi-generator-cli-7.25.0.jar}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

if [ $# -ge 1 ]; then
  cp "$1" "$WORK/openapi.json"
else
  curl -sSf -o "$WORK/openapi.json" https://api.aureahub.com/v1/docs/json
fi

node "$ROOT/scripts/filter-spec.mjs" "$WORK/openapi.json" "$ROOT/spec/operations.json" "$ROOT/spec/openapi.public.json"
shasum -a 256 "$WORK/openapi.json" | cut -d' ' -f1 > "$ROOT/spec/source.sha256"

java -jar "$GENERATOR_JAR" generate -i "$ROOT/spec/openapi.public.json" --skip-validate-spec \
  --openapi-normalizer KEEP_ONLY_FIRST_TAG_IN_OPERATION=true \
  -g typescript-fetch -o "$WORK/typescript" \
  --additional-properties="npmName=@aureahub/sdk,supportsES6=true" > "$WORK/generate.log" 2>&1 || {
    tail -n 50 "$WORK/generate.log"
    exit 1
  }

rm -rf "$ROOT/src/generated"
mkdir -p "$ROOT/src/generated"
cp -R "$WORK/typescript/src/." "$ROOT/src/generated/" 2>/dev/null || cp -R "$WORK/typescript/." "$ROOT/src/generated/"
# Only the sources: the generator's own package files are not this package's.
rm -rf "$ROOT/src/generated/.openapi-generator" "$ROOT/src/generated/.openapi-generator-ignore" \
  "$ROOT/src/generated/package.json" "$ROOT/src/generated/tsconfig.json" "$ROOT/src/generated/tsconfig.esm.json" \
  "$ROOT/src/generated/README.md" "$ROOT/src/generated/.gitignore" "$ROOT/src/generated/.npmignore"
java -jar "$GENERATOR_JAR" version > "$ROOT/spec/GENERATOR_VERSION"
echo "generated $(find "$ROOT/src/generated" -name '*.ts' | wc -l | tr -d ' ') files with openapi-generator $(cat "$ROOT/spec/GENERATOR_VERSION")"

node "$ROOT/scripts/write-services.mjs"
