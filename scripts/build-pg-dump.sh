#!/usr/bin/env bash
# Build only PostgreSQL's dump client, not a database server. Generated files stay
# out of Git; dist/tools is included in the application's deployment build.
set -euo pipefail
cd "$(dirname "$0")/.."
version=18.6
target="$PWD/dist/tools"
if [[ -x "$target/bin/pg_dump" ]] && LD_LIBRARY_PATH="$target/lib:${LD_LIBRARY_PATH:-}" "$target/bin/pg_dump" --version 2>/dev/null | grep -q " $version"; then
  exit 0
fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
base="https://ftp.postgresql.org/pub/source/v$version"
archive="postgresql-$version.tar.bz2"
curl --fail --silent --show-error --location "$base/$archive" -o "$work/$archive"
curl --fail --silent --show-error --location "$base/$archive.sha256" -o "$work/checksum"
(cd "$work"; sha256sum --check checksum)
tar -xjf "$work/$archive" -C "$work"
cd "$work/postgresql-$version"
./configure --prefix="$target" --without-readline \
  --without-icu --without-zlib --with-openssl
make -j2 -C src/backend generated-headers
make -j2 -C src/bin/pg_dump all
mkdir -p "$target/bin" "$target/lib"
cp src/bin/pg_dump/pg_dump "$target/bin/pg_dump"
cp src/interfaces/libpq/libpq.so.5.* "$target/lib/libpq.so.5"
LD_LIBRARY_PATH="$target/lib:${LD_LIBRARY_PATH:-}" "$target/bin/pg_dump" --version
