# Correo corporativo — contacto@encuentravet.cl

Guía de configuración del correo con dominio propio para **EncuentraVet**.
Diagnóstico DNS real ejecutado el **7 de septiembre de 2026**.

Para volver a revisar el estado en cualquier momento:

```bash
node scripts/verificar-correo-dns.mjs
```

---

## 1. Diagnóstico inicial (estado actual del dominio)

| Qué | Estado hoy | Comentario |
|---|---|---|
| **Nameservers** | `ns1.vercel-dns.com`, `ns2.vercel-dns.com` | El DNS **se administra en Vercel**, no en NIC Chile |
| **MX** | *(ninguno)* | El dominio **no puede recibir correo** |
| **SPF** | `v=spf1 include:amazonses.com -all` | Solo autoriza Amazon SES, y en modo estricto |
| **DKIM** | *(ninguno en los selectores estándar)* | Falta firmar el correo saliente |
| **DMARC** | `v=DMARC1; p=quarantine; rua=mailto:encuentra.vet@gmail.com; fo=1; adkim=r; aspf=r` | Política correcta, pero los reportes no llegan (ver abajo) |
| **A / wildcard** | `*.encuentravet.cl` → IPs de Vercel | `mail.` y `autodiscover.` responden por el comodín, no son servidores de correo |
| **Registro del dominio** | `.cl` → registro de NIC Chile | La *renovación* se paga en NIC Chile; los *registros DNS* se editan en Vercel |

### Dónde vas a trabajar

Todos los cambios de esta guía se hacen en **Vercel**, no en NIC Chile:

> vercel.com → tu equipo → **Domains** → `encuentravet.cl` → pestaña **DNS Records** → **Add**

NIC Chile solo se toca si algún día quieres cambiar los nameservers.

### ⚠️ Dos hallazgos que hay que corregir sí o sí

**1. El SPF actual romperá el correo de Google.**
`v=spf1 include:amazonses.com -all` autoriza **solo** a Amazon SES (el que usa el sitio para
sus correos automáticos) y el `-all` final significa *"cualquier otro remitente es falso,
recházalo"*. Si activas Google Workspace sin tocar este registro, **todo lo que envíes desde
contacto@encuentravet.cl fallará SPF** y, con `p=quarantine` en DMARC, se irá derecho a spam.
Hay que **editar** el registro existente (no crear uno nuevo: dos SPF invalidan ambos).

**2. Los reportes DMARC no te están llegando.**
El `rua=` apunta a `encuentra.vet@gmail.com`, que es un dominio distinto. La norma (RFC 7489)
exige que el dominio receptor publique una autorización; verifiqué
`encuentravet.cl._report._dmarc.gmail.com` y **no existe** (NXDOMAIN), así que Google, Microsoft
y Yahoo descartan esos reportes. Se arregla apuntando el `rua=` a una casilla del propio dominio.

---

## 2. Google Workspace vs Zoho Mail — para tu caso

| | **Google Workspace** (Business Starter) | **Zoho Mail** (Mail Lite) |
|---|---|---|
| **Precio** | USD 8,40 / usuario / mes con plan anual ≈ **$8.000–8.500 CLP + IVA** | USD 1 / usuario / mes anual ≈ **$1.000 CLP + IVA** |
| **Plan gratis** | No (14 días de prueba) | Sí, hasta 5 usuarios — **pero sin IMAP** |
| **Migración desde Gmail** | Nula: es el mismo Gmail, misma app, mismos atajos | Webmail y app distintos; hay que reaprender |
| **Alias adicionales** | Hasta 30 alias **gratis** por casilla | Alias incluidos también |
| **Entregabilidad** | La mejor del mercado; reputación de infraestructura Google | Buena, pero rangos de IP compartidos con más cuentas de bajo costo |
| **Almacenamiento** | 30 GB por usuario | 5 GB (Lite) / 10 GB |

### Recomendación: **Google Workspace**

Ya vives en Gmail, así que la migración es prácticamente inexistente: entras con otra cuenta y
todo funciona igual. Frente a marcas grandes como Zoetis o Salcobrand —que filtran fuerte— salir
desde infraestructura de Google con SPF y DKIM alineados es la posición más segura, y el plan
gratuito de Zoho queda descartado porque **sin IMAP no puedes leer ese correo desde la app de
Gmail**. La diferencia real de costo es de unos **$7.500 CLP al mes**: barato por no arriesgar
que una cotización caiga en spam.

**Costo total para tu caso: 1 sola licencia (~$8.500 CLP + IVA/mes).** `ventas@` y `marketing@`
van como **alias gratuitos** de la misma casilla, no como usuarios pagados.

---

## 3. Configuración paso a paso

### 3.1 Crear la cuenta

1. Entra a **https://workspace.google.com/business/signup/welcome**
2. Plan: **Business Starter**, **1 usuario** (los alias no se pagan).
3. Cuando pregunte por el dominio, elige *"Sí, tengo un dominio"* → `encuentravet.cl`.
4. Crea el usuario administrador: **contacto@encuentravet.cl**.
5. Google te mostrará un código de verificación del tipo
   `google-site-verification=XXXXXXXX`. **Cópialo, no cierres la ventana.**

> Ojo: el dominio ya tiene un `google-site-verification` de otro producto (Search Console).
> Ese se **deja tal cual**; el nuevo se agrega como un TXT adicional. Varios TXT conviven sin
> problema — la regla de "solo uno" aplica únicamente a SPF y a DMARC.

### 3.2 Registros a crear en Vercel

En **Domains → encuentravet.cl → DNS Records**. Para el dominio raíz, el campo *Name* se deja
**vacío** (Vercel lo interpreta como `@`). Pega los valores **sin comillas**.

| # | Name | Type | Priority | Value | Acción |
|---|---|---|---|---|---|
| 1 | *(vacío)* | TXT | — | `google-site-verification=XXXXXXXX` *(el que te dio Google)* | **Agregar** |
| 2 | *(vacío)* | MX | `1` | `smtp.google.com` | **Agregar** |
| 3 | *(vacío)* | TXT | — | `v=spf1 include:amazonses.com include:_spf.google.com -all` | **EDITAR el SPF existente** |
| 4 | `google._domainkey` | TXT | — | *(la clave DKIM que genera la consola, paso 3.3)* | **Agregar** |
| 5 | `_dmarc` | TXT | — | `v=DMARC1; p=quarantine; rua=mailto:dmarc@encuentravet.cl; ruf=mailto:dmarc@encuentravet.cl; fo=1; adkim=r; aspf=r; pct=100` | **EDITAR el DMARC existente** |

**Notas críticas:**

- **Registro 2 (MX):** Google usa hoy **un solo MX**, `smtp.google.com` con prioridad `1`.
  No agregues además los antiguos `ASPMX.L.GOOGLE.COM` / `ALT1…ALT4`: es uno **o** los otros,
  nunca ambos.
- **Registro 3 (SPF):** es una **edición**, no un registro nuevo. Borrar `include:amazonses.com`
  rompería los correos automáticos del sitio; crear un segundo SPF invalida los dos.
- **Registro 5 (DMARC):** también es una **edición**. Cambiar el `rua` a una dirección del propio
  dominio es lo que hace que por fin recibas los reportes.

### 3.3 Activar DKIM (después de crear la cuenta)

DKIM no se puede generar antes: la clave la emite Google.

1. **admin.google.com** → **Aplicaciones** → **Google Workspace** → **Gmail** → **Autenticar correo**.
2. Selecciona `encuentravet.cl` → **Generar nuevo registro** → longitud **2048 bits**, prefijo
   del selector **`google`**.
3. Copia el valor `v=DKIM1; k=rsa; p=MIIBIjANBg…` y pégalo en Vercel como el **registro 4**
   de la tabla (Name: `google._domainkey`).
4. Espera a que propague (paso 3.4) y **recién ahí** vuelve a esa pantalla y pulsa
   **Iniciar autenticación**. Si lo activas antes de que el DNS propague, Google falla y hay
   que reintentar.

### 3.4 Verificar la propagación

Antes de apretar "Verificar" en Google, corre:

```bash
node scripts/verificar-correo-dns.mjs
```

Debe mostrar en verde: MX de Google, SPF con `_spf.google.com`, DKIM `google` publicado y DMARC.
Si algo sigue en rojo, espera: la propagación toma entre 15 minutos y 2 horas.
Comandos equivalentes si prefieres hacerlo a mano:

```bash
dig +short MX  encuentravet.cl
dig +short TXT encuentravet.cl
dig +short TXT google._domainkey.encuentravet.cl
dig +short TXT _dmarc.encuentravet.cl
```

---

## 4. Cuentas y alias

**Una sola casilla pagada, tres direcciones.** Los alias son gratis y llegan todos a la misma
bandeja, así que no hay nada que revisar por separado.

| Dirección | Tipo | Costo |
|---|---|---|
| `contacto@encuentravet.cl` | Casilla principal (usuario) | Licencia pagada |
| `ventas@encuentravet.cl` | Alias de contacto@ | $0 |
| `marketing@encuentravet.cl` | Alias de contacto@ | $0 |
| `dmarc@encuentravet.cl` | Alias de contacto@ (reportes) | $0 |

**Cómo crearlos:** admin.google.com → **Directorio** → **Usuarios** → contacto@ →
**Información del usuario** → **Direcciones de correo alternativas (alias)** → agregar las tres.
Tardan unos minutos en activarse.

**Para poder responder *desde* cada alias:** en Gmail → ⚙️ **Ver toda la configuración** →
**Cuentas** → *Enviar como* → **Agregar otra dirección**. Agrega `ventas@` y `marketing@`
desmarcando *"Tratar como alias"* solo si quieres que las respuestas vuelvan a la dirección
original. Marca **"Responder desde la misma dirección a la que se envió el mensaje"** para que
quien escriba a ventas@ reciba la respuesta desde ventas@.

> **Cuándo convendría separar en casillas propias:** solo si más adelante entra otra persona al
> equipo y necesita ver *únicamente* ventas@ sin acceso al resto. Ahí recién agregas un usuario
> pagado. Mientras seas tú, los alias son estrictamente mejores.

---

## 5. Migración suave desde encuentra.vet@gmail.com

Las marcas que ya tienen guardado el Gmail antiguo seguirán escribiendo ahí por meses. Dos
mecanismos complementarios:

### 5.1 Reenvío automático (lo esencial)

En **encuentra.vet@gmail.com**: ⚙️ **Ver toda la configuración** → **Reenvío y correo POP/IMAP**
→ **Agregar una dirección de reenvío** → `contacto@encuentravet.cl` → Google manda un código de
confirmación a la casilla nueva → confírmalo → vuelve y marca
**"Reenviar una copia del correo entrante a…"** eligiendo **"conservar la copia de Gmail en
Recibidos"** (así no pierdes nada si algo falla el primer mes).

### 5.2 Bandeja combinada (recomendado además del reenvío)

En **contacto@encuentravet.cl**: ⚙️ → **Cuentas** → *Consultar correo de otras cuentas* →
**Agregar una cuenta de correo** → `encuentra.vet@gmail.com`. Trae también el **histórico**,
no solo lo nuevo, y te deja **enviar como** la dirección antigua cuando convenga responder
manteniendo el hilo.

### 5.3 Plan de transición sugerido

| Momento | Acción |
|---|---|
| Semana 1 | Reenvío activo. Firma nueva en todos los correos. |
| Semanas 1-4 | Responder siempre **desde** contacto@ (aunque llegue al Gmail viejo): entrena a tus contactos. |
| Mes 2 | Actualizar el correo en el sitio, Instagram, fichas de proveedores y firmas de cotizaciones. |
| Mes 3-6 | Mantener el reenvío. Revisar qué remitentes siguen usando la dirección vieja y avisarles. |
| Mes 6+ | Respuesta automática en el Gmail antiguo indicando la nueva dirección. **No cierres nunca esa cuenta**: se pierde el acceso a servicios registrados con ella. |

---

## 6. Firma de correo profesional

Reemplaza `[Tu nombre]`, `[Cargo]` y el teléfono.

### Texto plano

```
[Tu nombre]
[Cargo] · EncuentraVet Chile
contacto@encuentravet.cl · +56 9 XXXX XXXX
www.encuentravet.cl · Instagram: @encuentravet

Directorio de veterinarios verificados — 346 comunas de Chile
```

### HTML simple

Pégalo en Gmail → ⚙️ → **Ver toda la configuración** → **General** → **Firma** (Gmail acepta
HTML pegado desde el navegador; para que conserve el formato, abre el archivo en el navegador,
selecciona todo y copia-pega).

```html
<table cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#2b2b2b;line-height:1.5">
  <tr>
    <td style="border-left:3px solid #6D28D9;padding-left:12px">
      <div style="font-size:15px;font-weight:bold;color:#1a1a1a">[Tu nombre]</div>
      <div style="color:#555">[Cargo] · <span style="color:#6D28D9;font-weight:bold">EncuentraVet</span> Chile</div>
      <div style="margin-top:8px">
        <a href="mailto:contacto@encuentravet.cl" style="color:#2b2b2b;text-decoration:none">contacto@encuentravet.cl</a>
        &nbsp;·&nbsp; +56 9 XXXX XXXX
      </div>
      <div style="margin-top:2px">
        <a href="https://www.encuentravet.cl" style="color:#6D28D9;text-decoration:none;font-weight:bold">www.encuentravet.cl</a>
        &nbsp;·&nbsp;
        <a href="https://instagram.com/encuentravet" style="color:#6D28D9;text-decoration:none">@encuentravet</a>
      </div>
      <div style="margin-top:8px;font-size:11px;color:#888">
        Directorio de veterinarios verificados — 346 comunas de Chile
      </div>
    </td>
  </tr>
</table>
```

> Sin imágenes a propósito: los logos incrustados suben la probabilidad de spam en el primer
> contacto con una marca y muchos clientes los bloquean por defecto.

---

## 7. Checklist final

Marca cada punto antes de darlo por terminado:

- [ ] Cuenta Google Workspace creada con `contacto@encuentravet.cl`
- [ ] TXT de verificación agregado en Vercel y **dominio verificado** en Google
- [ ] MX `smtp.google.com` prioridad 1 (y **ningún otro MX**)
- [ ] SPF **editado** a `v=spf1 include:amazonses.com include:_spf.google.com -all` — un solo registro
- [ ] DKIM generado en la consola, publicado en `google._domainkey` y **autenticación iniciada**
- [ ] DMARC editado con `rua=mailto:dmarc@encuentravet.cl`
- [ ] `node scripts/verificar-correo-dns.mjs` **todo en verde**
- [ ] Alias `ventas@`, `marketing@` y `dmarc@` creados
- [ ] *Enviar como* configurado para ventas@ y marketing@
- [ ] **Prueba de envío**: mandar un correo a **https://www.mail-tester.com** → objetivo **10/10**
- [ ] **Prueba de recepción**: escribir desde el Gmail antiguo a contacto@, ventas@ y marketing@
- [ ] Reenvío desde `encuentra.vet@gmail.com` activo y confirmado
- [ ] Firma cargada en Gmail
- [ ] Correo actualizado en el sitio, Instagram y fichas de proveedores

### Herramientas de verificación

| Herramienta | Para qué |
|---|---|
| [mail-tester.com](https://www.mail-tester.com) | Nota global de entregabilidad (SPF+DKIM+DMARC+contenido). Apunta a 10/10 |
| [mxtoolbox.com/deliverability](https://mxtoolbox.com/deliverability) | Diagnóstico registro por registro |
| [dmarcian.com/dmarc-inspector](https://dmarcian.com/dmarc-inspector/) | Validar la sintaxis del DMARC |
| Gmail → "Mostrar original" | Confirmar `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS` en un correo real |

### Después: endurecer a `p=reject`

Cuando lleves **4-6 semanas** con los reportes DMARC llegando limpios a `dmarc@encuentravet.cl`,
cambia `p=quarantine` por `p=reject` en el registro `_dmarc`. Es la protección máxima contra
suplantación de tu dominio — importante cuando negocias con marcas grandes.
