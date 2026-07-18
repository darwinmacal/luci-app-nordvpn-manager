# Security policy

## Supported versions

Security fixes are provided for the current beta or stable release line that
targets OpenWrt `25.12.x`. Development snapshots and modified packages are not
supported.

## Reporting a vulnerability

Do not open a public issue for a suspected token leak, command injection,
firewall bypass, routing leak or privilege escalation. Use the repository's
private GitHub security advisory form and include:

- affected package version and OpenWrt build;
- logical topology without real public addresses or credentials;
- exact reproduction steps;
- observed firewall, route and packet-capture evidence;
- whether the kill switch was enabled;
- a proposed fix, if available.

Never attach a NordVPN token, private key, router backup or unredacted UCI dump.

## Security invariants

- The token must not appear in UCI, process arguments, logs, sysupgrade keep
  files, release artifacts or Git history.
- Credential paths must remain root-only.
- Every generated firewall and PBR rule must be scoped to the selected subnet.
- Enabling the kill switch must close WAN before changing fallback routing.
- Disabling it must prepare fallback routing before opening WAN.
- An unmanaged UCI section must never be overwritten or removed.
- IPv6 on the protected network must block setup until a supported IPv6 policy
  exists.
- A failed endpoint change must retain fail-closed behavior or restore the
  previously working endpoint.

## Política de seguridad

Las correcciones cubren la versión beta o estable vigente para OpenWrt
`25.12.x`. No publiques un issue si sospechas fuga de token, inyección de
comandos, bypass de firewall, fuga de rutas o escalamiento de privilegios. Usa
el formulario privado de avisos de seguridad de GitHub.

Incluye versión, topología lógica anonimizada, reproducción y evidencia de
firewall, rutas y captura. Nunca adjuntes tokens, claves privadas, respaldos del
router ni dumps UCI sin censurar.
