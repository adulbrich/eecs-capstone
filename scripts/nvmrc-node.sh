#!/bin/sh
# Run a command on the Node that .nvmrc names, or refuse with the reason.
#
# lefthook runs hooks under `sh`, which has no shell function, so a lazy-loaded
# nvm never fires and `node` is whatever is first on PATH, a Homebrew Node two
# majors ahead on the machine this was written on. On that Node the jsdom
# environment comes up without localStorage and about 65 unit tests fail in
# files that have nothing to do with the change (docs/QUIRKS.md, "Run the tests
# on the Node in .nvmrc"). A pre-push that fails that way teaches everyone to
# skip it, so this wrapper does the version switch itself and, when it cannot,
# fails on the version rather than on the tests.
#
# Usage: sh scripts/nvmrc-node.sh <command> [args...]

set -e

wanted=$(sed 's/^v//' .nvmrc 2>/dev/null | tr -d '[:space:]')
if [ -z "$wanted" ]; then
  exec "$@"
fi
wanted_major=${wanted%%.*}

running_major() {
  node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

if [ "$(running_major)" != "$wanted_major" ]; then
  # nvm: a function, not a binary, so it has to be sourced here.
  nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "$nvm_sh" ]; then
    # shellcheck disable=SC1090
    . "$nvm_sh" >/dev/null 2>&1 || true
    nvm use --silent >/dev/null 2>&1 || nvm use "$wanted" --silent >/dev/null 2>&1 || true
  elif command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env)"
    fnm use --silent-if-unchanged >/dev/null 2>&1 || true
  fi
fi

if [ "$(running_major)" != "$wanted_major" ]; then
  echo "Node $(node --version 2>/dev/null || echo '(none)') is on PATH but .nvmrc wants $wanted." >&2
  echo "Install it with nvm or fnm, or run the hook from a shell where \`node --version\` matches. See docs/QUIRKS.md, Vitest." >&2
  exit 1
fi

exec "$@"
