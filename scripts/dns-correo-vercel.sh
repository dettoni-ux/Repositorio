#!/usr/bin/env bash
# Carga en Vercel los registros DNS del correo corporativo de encuentravet.cl.
#
# Se ejecuta en TU computador (no en el contenedor de Claude, que no tiene
# acceso a la cuenta de Vercel). Requiere Node instalado.
#
#   1) npx vercel login          ← inicia sesión con tu cuenta
#   2) bash scripts/dns-correo-vercel.sh
#
# Los registros que faltan (DKIM) se agregan después, cuando Zoho entregue
# la clave. Ver CORREO-CORPORATIVO.md.

set -euo pipefail
DOMINIO="encuentravet.cl"
V="npx --yes vercel dns"

echo "==> Agregando los MX de Zoho a $DOMINIO"
$V add "$DOMINIO" '@' MX mx.zoho.com  10
$V add "$DOMINIO" '@' MX mx2.zoho.com 20
$V add "$DOMINIO" '@' MX mx3.zoho.com 50

echo
echo "==> Listo. Registros actuales:"
npx --yes vercel dns ls "$DOMINIO"

echo
echo "Verifica la propagación con:  node scripts/verificar-correo-dns.mjs"
