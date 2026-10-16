#!/bin/bash
# One-time setup so macOS keeps Accessibility and Screen Recording across rebuilds of the packaged app.
#
# macOS remembers those permissions by the app's code signature. An ad-hoc signature is a hash of the
# code, so every rebuild looks like a new app. This creates a self-signed code-signing certificate in its
# own keychain; forge.config.js signs every build with it, so the signature requirement stays the same.
#
# The keychain password only guards this local, self-signed certificate, which can sign nothing that
# any other Mac trusts. Run once: bash scripts/setup-mac-signing.sh
set -euo pipefail

NAME="Personalized Notetaker Local Signing"
KEYCHAIN="$HOME/Library/Keychains/notetaker-signing.keychain-db"
PASSWORD="notetaker-local-signing"

# codesign only finds identities in keychains on the user search list. Keep the existing ones first.
add_to_search_list() {
    if ! security list-keychains -d user | grep -q "notetaker-signing"; then
        # shellcheck disable=SC2046
        security list-keychains -d user -s $(security list-keychains -d user | tr -d '"') "$KEYCHAIN"
    fi
}

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
    add_to_search_list
    echo "Signing certificate already set up in $KEYCHAIN"
    exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 7300 \
    -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -subj "/CN=$NAME" \
    -addext "basicConstraints=critical,CA:false" \
    -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null

[ -f "$KEYCHAIN" ] || security create-keychain -p "$PASSWORD" "$KEYCHAIN"
security set-keychain-settings "$KEYCHAIN"
security unlock-keychain -p "$PASSWORD" "$KEYCHAIN"
security import "$WORK/key.pem" -k "$KEYCHAIN" -T /usr/bin/codesign >/dev/null
security import "$WORK/cert.pem" -k "$KEYCHAIN" >/dev/null
# Let codesign use the key without a password dialog.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASSWORD" "$KEYCHAIN" >/dev/null
add_to_search_list

echo "Created \"$NAME\" in $KEYCHAIN"
echo "Rebuild the app, then grant Accessibility and Screen & System Audio Recording one last time."
