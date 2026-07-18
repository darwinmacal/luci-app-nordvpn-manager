include $(TOPDIR)/rules.mk

PKG_VERSION:=0.1.0
PKG_RELEASE:=8
PKG_LICENSE:=GPL-2.0-only
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=OpenWrt NordVPN Manager contributors

LUCI_TITLE:=LuCI support for an unofficial NordVPN WireGuard manager
LUCI_DESCRIPTION:=Token-based NordVPN WireGuard selection with PBR, encrypted DNS and an optional kill switch
LUCI_DEPENDS:=+luci-base +luci-ssl +rpcd-mod-ucode +ucode-mod-fs +ucode-mod-ubus +ucode-mod-uci +curl +ca-bundle +wireguard-tools +kmod-wireguard +pbr +https-dns-proxy +ip-full
LUCI_PKGARCH:=all
LUCI_MAINTAINER:=OpenWrt NordVPN Manager contributors
LUCI_URL:=

define Package/luci-app-nordvpn-manager/conffiles
/etc/config/nordvpn_manager
endef

define Package/luci-app-nordvpn-manager/preinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
[ -r /etc/openwrt_release ] || exit 1
. /etc/openwrt_release
case "$${DISTRIB_RELEASE}" in
	25.12*) exit 0 ;;
	*) echo "luci-app-nordvpn-manager requires OpenWrt 25.12" >&2; exit 1 ;;
esac
endef

define Package/luci-app-nordvpn-manager/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	defaults=/etc/uci-defaults/99-nordvpn-manager
	if [ -x "$$defaults" ]; then
		"$$defaults" && rm -f "$$defaults"
	fi
	/usr/libexec/nordvpn-manager reconcile >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/* 2>/dev/null || true
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
}
exit 0
endef

define Package/luci-app-nordvpn-manager/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
[ "$${1:-}" = 'upgrade' ] && exit 0
[ "$${PKG_UPGRADE:-0}" = '1' ] && exit 0
if [ -x /usr/libexec/nordvpn-manager ] && ! /usr/libexec/nordvpn-manager can-uninstall; then
	echo "Disable protection from LuCI before uninstalling NordVPN Manager." >&2
	exit 1
fi
/etc/init.d/nordvpn-manager stop >/dev/null 2>&1 || true
/etc/init.d/nordvpn-manager disable >/dev/null 2>&1 || true
exit 0
endef

define Package/luci-app-nordvpn-manager/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/* /tmp/nordvpn-manager-* 2>/dev/null || true
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
}
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
