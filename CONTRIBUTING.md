# Contributing

Contributions must preserve the application's narrow ownership and fail-closed
security model.

1. Open an issue for behavioral changes before writing a large patch.
2. Keep physical ports, VLAN creation and device-specific topology out of the
   public package.
3. Never add real profiles, tokens, private/public key pairs, backups, serial
   numbers, addresses or router inventories.
4. Use UCI/ubus/jsonfilter for structured OpenWrt state.
5. Add an ownership marker to every new managed section.
6. Add English source strings and update the Spanish PO for visible text.
7. Run `./tests/run.sh`, the SDK build and relevant live leak tests.
8. Describe security and rollback effects in the pull request.

Shell must run under BusyBox `ash`. Ucode must compile with the OpenWrt 25.12
toolchain. LuCI JavaScript must work without a theme-specific dependency and
remain keyboard accessible at desktop and mobile widths.

## Español

Los cambios deben conservar la propiedad limitada y el comportamiento
fail-closed. No agregues topología física, perfiles reales, tokens, claves,
respaldos, seriales, direcciones ni inventarios. Añade marcador de propiedad a
cada sección administrada, traduce todo texto visible y ejecuta pruebas
estáticas, compilación SDK y matriz de fugas correspondiente.
