#!/usr/bin/env bash
# Refuse to ship if anything resembling a real credential is in the tree.
#
# This system talks to a MongoDB Atlas cluster, an AWS host and a TLS endpoint,
# so it holds three kinds of secret at once. A secret scanner once flagged a
# MongoDB connection string in src/newserver/.env before this repository was
# published, so the repository now checks itself rather than relying on someone
# remembering.
#
# Usage: make check   (or ./scripts/check-secrets.sh)

set -uo pipefail
cd "$(dirname "$0")/.."

status=0

# Files that legitimately hold real credentials at runtime. They must never be
# tracked by git. .env.example is the committed template and is fine.
echo "Checking for credential files that should not be tracked..."
secrets=$(git ls-files \
    | grep -E '(^|/)(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|myimage\.tar)$' \
    | grep -v '\.env\.example$')

if [ -n "$secrets" ]; then
    echo "  FAIL  these are tracked by git and can hold real credentials:"
    echo "$secrets" | sed 's/^/          /'
    status=1
fi

# The scanner's cache records what it once found, including the path of the
# offending file. That is not a secret, but publishing it is untidy and tells a
# reader more about past mistakes than about the system.
echo "Checking for scanner cache..."
if git ls-files --error-unmatch .cache_ggshield >/dev/null 2>&1; then
    echo "  FAIL  .cache_ggshield is tracked by git"
    status=1
fi

# A MongoDB URI is only a secret if it carries credentials, which means it has a
# user:password@ before the host. A URI like mongodb://mongo:27017/grocerydb has
# none — that colon is a port — so the local and compose connection strings are
# not flagged.
#
# Where credentials are present, the password must be a placeholder. Placeholders
# start with < (as in <password>) or $ (as in ${MONGO_PW}); anything else is real.
#
# -I skips binary files, so the architecture diagram and the PDFs are not
# scanned byte-by-byte and cannot produce a false failure. This script contains
# the patterns it searches for, so it also has to exclude itself.
echo "Checking for live MongoDB connection strings..."
uris=$(git ls-files -z \
    | grep -zZv -e '^scripts/check-secrets.sh$' \
    | xargs -0 grep -IhoE 'mongodb(\+srv)?://[^[:space:]"'"'"']+' 2>/dev/null \
    | grep -E '://[^/@[:space:]]*:[^/@[:space:]]*@' \
    | grep -vE '://[^/@[:space:]]*:[<$]' \
    | sort -u)

if [ -n "$uris" ]; then
    echo "  FAIL  found connection strings that do not use a placeholder password:"
    echo "$uris" | sed 's/^/          /'
    status=1
fi

# AWS access key IDs have a fixed, unmistakable shape.
echo "Checking for AWS access keys..."
keys=$(git ls-files -z \
    | grep -zZv -e '^scripts/check-secrets.sh$' \
    | xargs -0 grep -IhoE '\b(AKIA|ASIA)[0-9A-Z]{16}\b' 2>/dev/null \
    | sort -u)

if [ -n "$keys" ]; then
    echo "  FAIL  found what look like AWS access key IDs:"
    echo "$keys" | sed 's/^/          /'
    status=1
fi

# Private keys are unambiguous: the PEM header is the whole tell.
echo "Checking for private key material..."
pem=$(git ls-files -z \
    | grep -zZv -e '^scripts/check-secrets.sh$' \
    | xargs -0 grep -Il 'BEGIN .*PRIVATE KEY' 2>/dev/null \
    | sort -u)

if [ -n "$pem" ]; then
    echo "  FAIL  these files contain private key material:"
    echo "$pem" | sed 's/^/          /'
    status=1
fi

if [ "$status" -eq 0 ]; then
    echo
    echo "OK — nothing that looks like a real credential."
else
    echo
    echo "Secret check FAILED. Do not commit."
fi

exit "$status"
