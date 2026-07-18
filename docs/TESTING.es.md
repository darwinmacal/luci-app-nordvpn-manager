# Pruebas

La publicación se bloquea si falla una prueba estática, de paquete o de
enrutamiento en vivo.

## Validaciones estáticas

```sh
./tests/run.sh
```

La suite valida shell y ShellCheck, compilación Ucode, sintaxis JavaScript,
JSON, formato/cobertura PO, marcadores de propiedad y patrones conocidos de
secretos o topología privada.

## Compilación SDK

Usa el SDK oficial OpenWrt `25.12.5` MediaTek MT7622 y comprueba el archivo:

```text
0bd25a391256dbe9ad1f9c6f313364b1f9eddcc0e280c829d644034981ad8306
```

```sh
./scripts/build-sdk.sh /ruta/openwrt-sdk-25.12.5-mediatek-mt7622_gcc-14.3.0_musl.Linux-x86_64
```

El asistente instala solamente el grafo de dependencias del paquete. El equipo
de compilación todavía requiere las dependencias estándar del SDK de OpenWrt.

El APK debe ser arquitectura `all`, declarar solamente dependencias previstas y
no tratar el token como conffile.

## Interfaz

Sirve la raíz y abre `tests/ui/`:

```sh
python -m http.server 8765 --bind 127.0.0.1
```

Después de `npm install`, ejecuta la matriz automatizada para escritorio/móvil,
claro/oscuro e inglés/español:

```sh
npm run qa:ui
```

El arnés ejecuta la vista LuCI real con RPC simulado. Revisa escritorio, móvil,
claro, oscuro, foco por teclado, confirmación del kill switch, fallback, selector
de servidor, cuenta, ajustes y asistente. No debe existir overflow horizontal ni
scroll vertical interno.

## Matriz en router limpio

1. La LAN normal sale por la IP del proveedor.
2. La LAN protegida conectada sale por NordVPN.
3. Ninguna LAN llega a direcciones de la otra, salvo una regla externa explícita.
4. El puerto DNS 53 protegido se redirige al router.
5. El resolver usa HTTPS y su salida sigue WireGuard.
6. Standard, P2P, Double VPN y Onion devuelven servidores compatibles.
7. Un endpoint sin respuesta restaura el servidor anterior.

## Prueba de fugas

Usa tráfico TCP, UDP, ICMP y DNS continuo desde un cliente protegido, además de
captura en WAN. No basta con ping.

Con kill switch activado, derriba WireGuard y comprueba pérdida de Internet,
ausencia total del tráfico del cliente en WAN, bloqueo de DNS 53/853, ruta
`unreachable default` y reintentos del watchdog.

Con kill switch desactivado, repite la caída y comprueba salida WAN, DoH todavía
cifrado y aislamiento de la LAN normal. Activa el kill switch durante el
fallback y confirma que WAN se cierre antes de que la interfaz indique éxito.

## Persistencia

Prueba ambos estados después de reiniciar servicio, firewall, concesión DHCP,
router y paquete. Compara UCI, nftables, rutas PBR, origen DNS y LuCI. Cualquier
diferencia bloquea la versión.
