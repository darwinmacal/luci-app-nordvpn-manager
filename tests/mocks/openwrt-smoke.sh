#!/bin/sh

set -eu

cp /src/tests/mocks/bin/* /usr/bin/
chmod 755 /usr/bin/uci /usr/bin/ubus /usr/bin/jsonfilter /usr/bin/ipcalc.sh
mkdir -p /usr/libexec /etc/config /etc/nordvpn-manager/credentials
cp /src/root/usr/libexec/nordvpn-manager /usr/libexec/nordvpn-manager
cp /src/root/usr/libexec/nordvpn-manager-api /usr/libexec/nordvpn-manager-api
cp /src/root/etc/config/nordvpn_manager /etc/config/nordvpn_manager
chmod 755 /usr/libexec/nordvpn-manager /usr/libexec/nordvpn-manager-api

output="$(/usr/libexec/nordvpn-manager preflight wan vpnlan)"
printf '%s\n' "$output" | grep -q '^protected_subnet=172.20.20.0/24$'
printf '%s\n' "$output" | grep -q '^source_zone=lan$'
printf '%s\n' "$output" | grep -q '^wan_zone=wan$'

if /usr/libexec/nordvpn-manager preflight wan wan >/dev/null 2>&1; then
	echo 'same-network preflight unexpectedly succeeded' >&2
	exit 1
fi

if /usr/libexec/nordvpn-manager preflight 'wan;id' vpnlan >/dev/null 2>&1; then
	echo 'unsafe network name unexpectedly succeeded' >&2
	exit 1
fi

touch /tmp/mock-ipv6
if /usr/libexec/nordvpn-manager preflight wan vpnlan >/dev/null 2>&1; then
	echo 'IPv6 leak preflight unexpectedly succeeded' >&2
	exit 1
fi
rm -f /tmp/mock-ipv6

/usr/libexec/nordvpn-manager can-uninstall

printf '%s\n' 'not-a-token' > /tmp/invalid-token
if /usr/libexec/nordvpn-manager-api enroll /tmp/invalid-token >/dev/null 2>&1; then
	echo 'invalid token unexpectedly succeeded' >&2
	exit 1
fi

printf 'OpenWrt mock smoke tests passed.\n'
