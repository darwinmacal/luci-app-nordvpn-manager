#!/bin/sh

set -eu

if [ $# -ne 1 ]; then
	echo "Usage: $0 /path/to/openwrt-sdk-25.12.x" >&2
	exit 2
fi

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"
SDK="$(CDPATH='' cd -- "$1" && pwd)"
STAGE="$SDK/package/luci-app-nordvpn-manager"
STAGE_MARKER="$STAGE/.nordvpn-manager-build-source"

[ -x "$SDK/scripts/feeds" ] || { echo 'Invalid OpenWrt SDK path' >&2; exit 1; }

case "$(basename "$SDK")" in
	openwrt-sdk-25.12.*) ;;
	*) echo 'This release must be built with an OpenWrt 25.12 SDK' >&2; exit 1 ;;
esac

case "$SDK/" in
	"$ROOT/"*)
		echo 'The SDK must be outside the package source tree to avoid a symlink loop' >&2
		exit 1
		;;
esac

TARGET_HINT=''
for path in "$SDK"/build_dir/target-*/linux-*_*; do
	[ -d "$path" ] || continue
	[ -z "$TARGET_HINT" ] || {
		echo 'The SDK contains more than one kernel target' >&2
		exit 1
	}
	TARGET_HINT="$path"
done

[ -n "$TARGET_HINT" ] || {
	echo 'Unable to derive the target from the SDK kernel build directory' >&2
	exit 1
}

TARGET_PAIR="${TARGET_HINT##*/linux-}"
case "$TARGET_PAIR" in
	*_*) ;;
	*) echo 'Unable to split the SDK target and subtarget' >&2; exit 1 ;;
esac
TARGET_BOARD="${TARGET_PAIR%%_*}"
TARGET_SUBTARGET="${TARGET_PAIR#*_}"

case "$TARGET_BOARD" in
	''|*[!A-Za-z0-9_-]*)
		echo 'Unable to derive a safe target from the SDK' >&2
		exit 1
		;;
esac

case "$TARGET_SUBTARGET" in
	''|*[!A-Za-z0-9_-]*)
		echo 'Unable to derive a safe subtarget from the SDK' >&2
		exit 1
		;;
esac

if [ "${NVM_UPDATE_FEEDS:-1}" = '1' ]; then
	(
		cd "$SDK"
		./scripts/feeds update -a
		./scripts/feeds uninstall -a
		./scripts/feeds install \
			luci-base \
			luci-ssl \
			rpcd-mod-ucode \
			ucode-mod-fs \
			ucode-mod-ubus \
			ucode-mod-uci \
			curl \
			ca-bundle \
			wireguard-tools \
			kmod-wireguard \
			pbr \
			https-dns-proxy \
			ip-full
	)
fi

if [ -L "$STAGE" ]; then
	[ "$(readlink -f "$STAGE")" = "$ROOT" ] || {
		echo "$STAGE is an unrelated symbolic link" >&2
		exit 1
	}
	rm "$STAGE"
elif [ -e "$STAGE" ] && [ ! -f "$STAGE_MARKER" ]; then
	echo "$STAGE is an unrelated package directory" >&2
	exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"
for item in Makefile LICENSE README.md htdocs po root; do
	[ ! -e "$ROOT/$item" ] || cp -a "$ROOT/$item" "$STAGE/"
done
: > "$STAGE_MARKER"

# Release SDKs expose the complete package catalogue and may omit .config.
# Reset the controllable global selectors before compiling this package.
cat > "$SDK/.config" <<EOF
CONFIG_TARGET_${TARGET_BOARD}=y
CONFIG_TARGET_${TARGET_BOARD}_${TARGET_SUBTARGET}=y
# CONFIG_TARGET_MULTI_PROFILE is not set
# CONFIG_TARGET_ALL_PROFILES is not set
# CONFIG_ALL is not set
# CONFIG_ALL_KMODS is not set
# CONFIG_ALL_NONSHARED is not set
CONFIG_AUTOREMOVE=y
CONFIG_USE_APK=y
CONFIG_PACKAGE_luci-app-nordvpn-manager=m
CONFIG_LUCI_LANG_es=y
CONFIG_PACKAGE_luci-i18n-nordvpn-manager-es=m
EOF

(
	cd "$SDK"
	make defconfig
	for option in CONFIG_ALL CONFIG_ALL_KMODS CONFIG_ALL_NONSHARED; do
		if grep -Eq "^${option}=[ym]$" .config; then
			echo "Minimal SDK configuration failed: ${option} is still enabled" >&2
			exit 1
		fi
	done
	# This architecture-independent LuCI package only needs LuCI's host tools.
	# Runtime dependencies remain in the APK metadata, while NO_DEPS avoids
	# rebuilding every kernel module preselected by release SDKs.
	make package/luci-base/host/compile \
		-j"${NVM_JOBS:-2}" \
		V="${NVM_VERBOSE:-}" \
		CONFIG_AUTOREMOVE=y \
		NO_DEPS=1
	make package/luci-app-nordvpn-manager/clean NO_DEPS=1
	make package/luci-app-nordvpn-manager/compile \
		-j"${NVM_JOBS:-2}" \
		V="${NVM_VERBOSE:-}" \
		CONFIG_AUTOREMOVE=y \
		NO_DEPS=1
)

find "$SDK/bin" -type f \( \
	-name 'luci-app-nordvpn-manager-*.apk' -o \
	-name 'luci-i18n-nordvpn-manager-es-*.apk' \
\) -print
