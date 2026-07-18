#!/bin/sh

set -eu

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SHELL_FILES="
root/usr/libexec/nordvpn-manager
root/usr/libexec/nordvpn-manager-api
root/usr/libexec/nordvpn-manager-health
root/etc/init.d/nordvpn-manager
root/etc/hotplug.d/iface/95-nordvpn-manager
root/etc/uci-defaults/99-nordvpn-manager
scripts/build-sdk.sh
tests/security-scan.sh
tests/mocks/openwrt-smoke.sh
tests/mocks/bin/uci
tests/mocks/bin/ubus
tests/mocks/bin/jsonfilter
tests/mocks/bin/ipcalc.sh
"

for file in $SHELL_FILES; do
	sh -n "$file"
done

if command -v shellcheck >/dev/null 2>&1; then
	shellcheck -x -e SC2015 $SHELL_FILES
elif command -v docker >/dev/null 2>&1; then
	docker run --rm -v "$ROOT:/mnt:ro" -w /mnt koalaman/shellcheck:stable -x -e SC2015 $SHELL_FILES
else
	echo 'shellcheck or docker is required' >&2
	exit 1
fi

node -e 'new Function(require("node:fs").readFileSync(process.argv[1], "utf8"))' \
	htdocs/luci-static/resources/view/nordvpn-manager/overview.js
node --check tests/ui/harness.js
node tests/check-translations.js
jq -e . root/usr/share/luci/menu.d/luci-app-nordvpn-manager.json >/dev/null
jq -e . root/usr/share/rpcd/acl.d/luci-app-nordvpn-manager.json >/dev/null
msgfmt --check-format --check-header -o /tmp/nordvpn-manager-es.mo po/es/nordvpn-manager.po

if command -v ucode >/dev/null 2>&1; then
	ucode -cdynlink=uci -o /tmp/nordvpn-manager.ucb root/usr/share/rpcd/ucode/nordvpn_manager.uc
elif command -v docker >/dev/null 2>&1; then
	docker run --rm -v "$ROOT:/src:ro" -w /tmp alpine:edge sh -c \
		'apk add --no-cache ucode >/dev/null && ucode -cdynlink=uci -o /tmp/nordvpn-manager.ucb /src/root/usr/share/rpcd/ucode/nordvpn_manager.uc'
else
	echo 'ucode or docker is required' >&2
	exit 1
fi

./tests/security-scan.sh

if command -v docker >/dev/null 2>&1; then
	docker run --rm -v "$ROOT:/src:ro" alpine:3.22 sh /src/tests/mocks/openwrt-smoke.sh
else
	echo 'docker is required for OpenWrt mock tests' >&2
	exit 1
fi

printf 'All local checks passed.\n'
