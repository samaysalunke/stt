#!/usr/bin/env bash
# Tracks the UI-refresh cleanup: inline styles, in-markup CSS vars, hardcoded hex,
# and global style blocks — split by the phase that owns each scope.
# Counts OCCURRENCES (grep -o), not matching lines, so a line with two inline
# styles counts as two. Usage: bash scripts/slop-metrics.sh
set -uo pipefail
cd "$(dirname "$0")/.."

PUBLIC_FILES=$(find src \( -name '*.astro' -o -name '*.tsx' \) | grep -v '/pages/admin/' | grep -v '/components/admin/' | grep -v 'AdminLayout')
ADMIN_FILES=$(find src/pages/admin src/components/admin \( -name '*.astro' -o -name '*.tsx' \) 2>/dev/null; echo src/layouts/AdminLayout.astro)

pcount() { printf '%s' "$(echo "$PUBLIC_FILES" | xargs grep -Ion "$1" 2>/dev/null | wc -l | tr -d ' ')"; }
acount() { printf '%s' "$(echo "$ADMIN_FILES"  | xargs grep -Ion "$1" 2>/dev/null | wc -l | tr -d ' ')"; }

echo "=== STT slop metrics — $(date '+%Y-%m-%d %H:%M') — $(git branch --show-current) ==="
printf '%-28s %8s %8s\n' 'metric' 'public' 'admin'
printf '%-28s %8s %8s\n' 'inline style="'        "$(pcount 'style="')"     "$(acount 'style="')"
printf '%-28s %8s %8s\n' 'var(--color in markup' "$(pcount 'var(--color')"  "$(acount 'var(--color')"
printf '%-28s %8s %8s\n' 'hardcoded #hex'        "$(pcount '#[0-9a-fA-F]\{6\}')" "$(acount '#[0-9a-fA-F]\{6\}')"
printf '%-28s %8s %8s\n' 'style is:global blocks' "$(pcount 'style is:global')" "$(acount 'style is:global')"
echo
echo "distinct data-testid: $(grep -rIoh 'data-testid="[^"]*"' src | sort -u | wc -l | tr -d ' ')"
echo
echo "--- top public offenders (inline style) ---"
for f in $PUBLIC_FILES; do
  n=$(grep -Ion 'style="' "$f" 2>/dev/null | wc -l | tr -d ' ')
  [ "${n:-0}" -gt 0 ] && printf '%4s %s\n' "$n" "$f"
done | sort -rn | head -15
exit 0
