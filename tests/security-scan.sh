#!/bin/sh

set -eu

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() {
	printf 'security-scan: %s\n' "$*" >&2
	exit 1
}

for pattern in '*.conf' '*.key' '*.pem' '*.p12' '*.pfx' '*.tar.gz' '*.sysupgrade.tar'; do
	if find . -type f -name "$pattern" -print -quit | grep -q .; then
		fail "forbidden file pattern present: $pattern"
	fi
done

if find . -type f | grep -E '/(backup|backups|private|credentials|token)(/|$)' >/dev/null; then
	fail 'private or credential directory/file name present'
fi

if rg -n --hidden --glob '!.git/**' --glob '!tests/security-scan.sh' \
	'(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|PrivateKey[[:space:]]*=|Authorization:[[:space:]]*(Bearer|Basic)|nordlynx_private_key[[:space:]]*[=:][[:space:]]*[A-Za-z0-9+/]{40})' .; then
	fail 'private credential material detected'
fi

if rg -n --hidden --glob '!.git/**' --glob '!tests/security-scan.sh' \
	'(10\.10\.(12|13)\.|192\.168\.2\.|35756/[A-Z0-9]+|qeR\^0v75|Style2619|5Cy7GzJM)' .; then
	fail 'private topology or known credential marker detected'
fi

if rg -n '(profile_root|read_profile|profile_path|legacy_state|\.conf([^A-Za-z0-9_]|$))' \
	root/usr/libexec root/usr/share/rpcd htdocs; then
	fail 'static-profile implementation detected'
fi

if rg -n -i 'token' root/etc/config/nordvpn_manager root/lib/upgrade/keep.d/nordvpn-manager; then
	fail 'token referenced by UCI defaults or sysupgrade keep list'
fi

rg -q 'set_rule_common.*()' root/usr/libexec/nordvpn-manager || fail 'firewall rule helper missing'
rg -q 'firewall\.\$section\.nvm_owner=1' root/usr/libexec/nordvpn-manager || fail 'firewall rule ownership marker missing'
# shellcheck disable=SC2016
for marker in \
	'firewall.nvm_vpn.nvm_owner' \
	'firewall.nvm_dns_redirect.nvm_owner' \
	'pbr.nvm_protected.nvm_owner' \
	'pbr.nvm_dns.nvm_owner' \
	'https-dns-proxy.nordvpn_manager.nvm_owner' \
	'network.\$wg.nvm_owner' \
	'network.\$peer.nvm_owner'; do
	rg -q "$marker" root/usr/libexec/nordvpn-manager || fail "ownership marker missing: $marker"
done

set_function="$(sed -n '/^set_killswitch()/,/^}/p' root/usr/libexec/nordvpn-manager)"
enable_block="$(printf '%s\n' "$set_function" | grep -n "configure_firewall_mode '1'" | cut -d: -f1)"
enable_route="$(printf '%s\n' "$set_function" | grep -n "apply_fallback_route '1'" | cut -d: -f1)"
disable_route="$(printf '%s\n' "$set_function" | grep -n "apply_fallback_route '0'" | cut -d: -f1)"
disable_open="$(printf '%s\n' "$set_function" | grep -n "configure_firewall_mode '0'" | cut -d: -f1)"
[ "$enable_block" -lt "$enable_route" ] || fail 'kill switch enable order is not fail-closed'
[ "$disable_route" -lt "$disable_open" ] || fail 'kill switch disable order can open before fallback'

rg -q 'firewall\.nvm_block_wan\.src_ip="\$subnet"' root/usr/libexec/nordvpn-manager ||
	fail 'WAN block is not scoped to the protected subnet'
rg -q 'firewall\.nvm_allow_wan\.src_ip="\$subnet"' root/usr/libexec/nordvpn-manager ||
	fail 'WAN fallback is not scoped to the protected subnet'
for section in nvm_to_vpn nvm_block_wan nvm_allow_wan; do
	rg -q "firewall\.${section}\.proto='all'" root/usr/libexec/nordvpn-manager ||
		fail "managed forwarding rule does not cover all IPv4 protocols: $section"
done
rg -q '/usr/libexec/nordvpn-manager reconcile' Makefile ||
	fail 'package upgrades do not reconcile managed firewall rules'

if rg -q 'https-dns-proxy\.nordvpn_manager\.enabled' root/usr/libexec/nordvpn-manager; then
	fail 'https-dns-proxy does not support per-instance enabled state'
fi
rg -q "DNS_URL='https://9\.9\.9\.9/dns-query'" root/usr/libexec/nordvpn-manager ||
	fail 'Quad9 fallback still depends on upstream plaintext hostname resolution'
fallback_cleanup="$(sed -n '/^remove_fallback_route()/,/^}/p' root/usr/libexec/nordvpn-manager)"
# shellcheck disable=SC2016
printf '%s\n' "$fallback_cleanup" | grep -q 'del unreachable default table "$table" ' ||
	fail 'fallback cleanup leaves the unmetriced PBR unreachable route active'
dns_sync="$(sed -n '/^sync_dns_route()/,/^}/p' root/usr/libexec/nordvpn-manager)"
printf '%s\n' "$dns_sync" | grep -q 'configure_dns_base' ||
	fail 'encrypted DNS instance is not recreated for an allowed route'
printf '%s\n' "$dns_sync" | grep -q 'delete https-dns-proxy.nordvpn_manager' ||
	fail 'fail-closed mode does not remove the encrypted DNS listener'
printf '%s\n' "$dns_sync" | grep -q 'restart >/dev/null 2>&1 || true' ||
	fail 'https-dns-proxy reload status is still treated as authoritative'
printf '%s\n' "$dns_sync" | grep -q 'wait_for_pbr_idle' ||
	fail 'encrypted DNS route can race a pending PBR interface reload'
printf '%s\n' "$dns_sync" | grep -q 'wait_for_dns_proxy' ||
	fail 'encrypted DNS startup does not retry real queries'

dns_wait="$(sed -n '/^wait_for_dns_proxy()/,/^}/p' root/usr/libexec/nordvpn-manager)"
printf '%s\n' "$dns_wait" | grep -q 'dns_proxy_healthy 2' ||
	fail 'encrypted DNS startup retries do not perform real DNS exchanges'
printf '%s\n' "$dns_wait" | grep -q 'sleep 1' ||
	fail 'encrypted DNS startup retries have no startup grace period'

pbr_wait="$(sed -n '/^wait_for_pbr_idle()/,/^}/p' root/usr/libexec/nordvpn-manager)"
printf '%s\n' "$pbr_wait" | grep -q 'quiet.*2' ||
	fail 'PBR synchronization does not require a stable idle period'

pbr_running="$(sed -n '/^pbr_operation_running()/,/^}/p' root/usr/libexec/nordvpn-manager)"
printf '%s\n' "$pbr_running" | grep -q "grep -Fqx '/etc/init.d/pbr'" ||
	fail 'PBR process detection does not compare complete argv entries'
if printf '%s\n' "$pbr_running" | grep -q "\*'/etc/init.d/pbr '"; then
	fail 'PBR process detection can be fooled by a command-string substring'
fi

pbr_false_argv="$(mktemp)"
pbr_real_argv="$(mktemp)"
trap 'rm -f "$pbr_false_argv" "$pbr_real_argv"' EXIT HUP INT TERM
printf '/bin/ash\000-c\000echo /etc/init.d/pbr restart\000' > "$pbr_false_argv"
printf '/bin/sh\000/etc/rc.common\000/etc/init.d/pbr\000restart\000' > "$pbr_real_argv"
if tr '\000' '\n' < "$pbr_false_argv" | grep -Fqx '/etc/init.d/pbr'; then
	fail 'PBR argv detector accepts a command string containing the path'
fi
tr '\000' '\n' < "$pbr_real_argv" | grep -Fqx '/etc/init.d/pbr' ||
	fail 'PBR argv detector rejects a real init-script argument'
rm -f "$pbr_false_argv" "$pbr_real_argv"
trap - EXIT HUP INT TERM

connect_flow="$(sed -n '/^connect_record()/,/^}/p' root/usr/libexec/nordvpn-manager)"
if printf '%s\n' "$connect_flow" | grep -q '/etc/init.d/pbr restart'; then
	fail 'connection flow still restarts PBR outside sync_dns_route'
fi

disconnect_flow="$(sed -n '/^disconnect_vpn()/,/^}/p' root/usr/libexec/nordvpn-manager)"
if printf '%s\n' "$disconnect_flow" | grep -q '/etc/init.d/pbr restart'; then
	fail 'disconnect flow still restarts PBR outside sync_dns_route'
fi

dns_health="$(sed -n '/^dns_proxy_healthy()/,/^}/p' root/usr/libexec/nordvpn-manager)"
printf '%s\n' "$dns_health" | grep -q 'cmp -s' ||
	fail 'encrypted DNS health check does not verify the transaction id'
printf '%s\n' "$dns_health" | grep -q 'umask 077' ||
	fail 'encrypted DNS health check files are not private'

dns_config="$(sed -n '/^configure_dns_base()/,/^}/p' root/usr/libexec/nordvpn-manager)"
delete_line="$(printf '%s\n' "$dns_config" | grep -n 'delete https-dns-proxy.nordvpn_manager' | tail -n1 | cut -d: -f1)"
create_line="$(printf '%s\n' "$dns_config" | grep -n 'nordvpn_manager=https-dns-proxy' | cut -d: -f1)"
[ "$delete_line" -lt "$create_line" ] ||
	fail 'owned encrypted DNS section is not reset before recreation'

printf 'Security scan passed.\n'
