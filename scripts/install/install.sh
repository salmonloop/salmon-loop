#!/usr/bin/env bash
set -euo pipefail

REPO="${SALMONLOOP_REPO:-salmonloop/salmon-loop}"
VERSION="${SALMONLOOP_VERSION:-latest}"
INSTALL_DIR="${SALMONLOOP_INSTALL_DIR:-${HOME}/.local/bin}"

usage() {
  cat <<'EOF'
Usage:
  install.sh [--version <tag>] [--dir <install-dir>]

Environment variables:
  SALMONLOOP_REPO         GitHub repo (default: salmonloop/salmon-loop)
  SALMONLOOP_VERSION      Release tag or "latest" (default: latest)
  SALMONLOOP_INSTALL_DIR  Install directory (default: ~/.local/bin)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"; shift 2 ;;
    --dir)
      INSTALL_DIR="${2:-}"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2 ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

require_cmd curl

os="$(uname -s)"
arch="$(uname -m)"

detect_libc() {
  if command -v ldd >/dev/null 2>&1; then
    if ldd --version 2>&1 | grep -qi musl; then
      echo "musl"
      return
    fi
  fi
  if [[ -e /lib/ld-musl-x86_64.so.1 ]] || [[ -e /usr/glibc-compat/lib/ld-linux-x86-64.so.2 ]]; then
    echo "musl"
    return
  fi
  echo "gnu"
}

target=""
case "${os}" in
  Darwin)
    case "${arch}" in
      arm64) target="salmon-loop-darwin-arm64" ;;
      x86_64) target="salmon-loop-darwin-x64" ;;
      *) echo "Unsupported macOS arch: ${arch}" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    case "${arch}" in
      x86_64)
        libc="$(detect_libc)"
        target="salmon-loop-linux-x64-${libc}"
        ;;
      *) echo "Unsupported Linux arch: ${arch}" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: ${os}" >&2
    exit 1
    ;;
esac

api_base="https://api.github.com/repos/${REPO}/releases"

resolve_version() {
  if [[ "${VERSION}" != "latest" ]]; then
    echo "${VERSION}"
    return
  fi

curl -fsSL "${api_base}/latest" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

tag="$(resolve_version)"
if [[ -z "${tag}" ]]; then
  echo "Failed to resolve release tag (repo=${REPO}, version=${VERSION})" >&2
  exit 1
fi

tmp="$(mktemp -d)"
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT

asset_url="https://github.com/${REPO}/releases/download/${tag}/${target}"
sums_url="https://github.com/${REPO}/releases/download/${tag}/SHA256SUMS"

echo "Downloading ${asset_url}" >&2
curl -fsSL -o "${tmp}/${target}" "${asset_url}"
curl -fsSL -o "${tmp}/SHA256SUMS" "${sums_url}"

verify_sha256() {
  local file="$1"
  local sums="$2"
  local name="$3"

  local expected
  expected="$(grep -E "[[:space:]]${name}$" "${sums}" | awk '{print $1}' | head -n 1 || true)"
  if [[ -z "${expected}" ]]; then
    echo "SHA256SUMS does not contain an entry for ${name}" >&2
    exit 1
  fi

  local actual=""
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "${file}" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "${file}" | awk '{print $1}')"
  else
    echo "Missing sha256sum/shasum for checksum verification" >&2
    exit 1
  fi

  if [[ "${actual}" != "${expected}" ]]; then
    echo "Checksum mismatch for ${name}" >&2
    echo "Expected: ${expected}" >&2
    echo "Actual:   ${actual}" >&2
    exit 1
  fi
}

verify_sha256 "${tmp}/${target}" "${tmp}/SHA256SUMS" "${target}"

mkdir -p "${INSTALL_DIR}"
install_path="${INSTALL_DIR}/salmon-loop"
cp -f "${tmp}/${target}" "${install_path}"
chmod +x "${install_path}"

link_or_copy() {
  local src="$1"
  local dst="$2"
  rm -f "${dst}"
  if ln -s "${src}" "${dst}" 2>/dev/null; then
    return
  fi
  cp -f "${src}" "${dst}"
}

link_or_copy "${install_path}" "${INSTALL_DIR}/s8p"

echo "Installed:" >&2
echo "  ${install_path}" >&2
echo "  ${INSTALL_DIR}/s8p" >&2

echo "Make sure ${INSTALL_DIR} is on your PATH." >&2

