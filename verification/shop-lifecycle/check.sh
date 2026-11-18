#!/usr/bin/env bash
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=${OUT:-$(mktemp -d)}
mkdir -p "$out"
status=0

"$here/../tlc.sh" "$here/ShopLifecycle.tla" "$here/ShopLifecycle.cfg" >"$out/guarantee.out" 2>&1
if grep -q '^Model checking completed. No error has been found.' "$out/guarantee.out"; then
  echo "guarantee (ShopLifecycle.cfg): every rule holds — $(grep -o '[0-9]* distinct states found' "$out/guarantee.out" | tail -1)"
else
  echo "guarantee (ShopLifecycle.cfg): FAILED — see $out/guarantee.out"
  grep -E '^Error|is violated' "$out/guarantee.out"
  status=1
fi

for rule in UninstallErasesShop NoStaleErase; do
  "$here/../tlc.sh" "$here/ShopLifecycle.tla" "$here/$rule.cfg" >"$out/$rule.out" 2>&1
  if grep -q "^Error: Invariant $rule is violated." "$out/$rule.out"; then
    echo "known finding ($rule.cfg): still reproduces — counterexample in $out/$rule.out"
  elif grep -q '^Model checking completed. No error has been found.' "$out/$rule.out"; then
    echo "known finding ($rule.cfg): NO LONGER REPRODUCES — if the code fixed it, move $rule into ShopLifecycle.cfg and delete $rule.cfg"
    status=1
  else
    echo "known finding ($rule.cfg): TLC did not finish — see $out/$rule.out"
    status=1
  fi
done

echo "TLC output: $out"
exit $status
