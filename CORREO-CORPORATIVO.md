# Correo corporativo — contacto@encuentravet.cl

Guía de configuración del correo con dominio propio para **EncuentraVet**.
Diagnóstico DNS real ejecutado el **7 de septiembre de 2026**.

> **Decisión tomada:** Zoho Mail Lite (5 GB), 1 usuario, **facturación anual** (USD 12/año).
> `contacto@` es la casilla; `ventas@`, `marketing@` y `dmarc@` van como alias gratuitos.
> El correo se sigue leyendo y respondiendo desde Gmail (paso 3.5).

## ⏳ Lo único que queda por hacer

El DNS está completo y verificado. Lo que sigue son acciones dentro de paneles con sesión
iniciada (Zoho, Vercel, Gmail), en este orden:

| # | Dónde | Qué | Tiempo |
|---|---|---|---|
| 1 | Zoho → Usuarios → contacto@ → Alias | Crear `ventas@`, `marketing@`, `dmarc@` | 2 min |
| 2 | Vercel → DNS Records | Borrar el TXT `_dmarc` viejo y crear el nuevo (§3.2, registro 7) | 1 min |
| 3 | Gmail antiguo → Reenvío | Reenviar a contacto@ (§5.1) | 2 min |
| 4 | Gmail → Cuentas | Recibir por POP y enviar por SMTP de Zoho (§3.5) | 5 min |
| 5 | Gmail → Firma | Pegar `firma-correo.html` (ábrelo en el navegador) | 2 min |
| 6 | mail-tester.com | Enviar desde contacto@ y comprobar 10/10 | 2 min |

Después de cada cambio de DNS: `node scripts/verificar-correo-dns.mjs`

---

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
| **SPF** | `v=spf1 include:amazonses.com -all` | **Roto**: `amazonses.com` no publica SPF → PermError |
| **DKIM** | *(ninguno en los selectores estándar)* | Falta firmar el correo saliente |
| **DMARC** | `v=DMARC1; p=quarantine; rua=mailto:encuentra.vet@gmail.com; fo=1; adkim=r; aspf=r` | Política correcta, pero los reportes no llegan (ver abajo) |
| **A / wildcard** | `*.encuentravet.cl` → IPs de Vercel | `mail.` y `autodiscover.` responden por el comodín, no son servidores de correo |
| **Registro del dominio** | `.cl` → registro de NIC Chile | La *renovación* se paga en NIC Chile; los *registros DNS* se editan en Vercel |

### Dónde vas a trabajar

Todos los cambios de esta guía se hacen en **Vercel**, no en NIC Chile:

> vercel.com → tu equipo → **Domains** → `encuentravet.cl` → pestaña **DNS Records** → **Add**

NIC Chile solo se toca si algún día quieres cambiar los nameservers.

### ⚠️ Dos hallazgos que hay que corregir sí o sí

**1. El SPF actual está roto, y no por el proveedor nuevo.**
El `-all` final significa *"cualquier remitente que no esté autorizado aquí es falso"*, así que
si activas Zoho sin tocarlo, todo lo que envíes fallará SPF y con `p=quarantine` se irá a spam.
Pero hay algo peor y anterior: **`amazonses.com` no publica ningún registro SPF** (verificado
contra los resolvers de Google y de Cloudflare). Según la RFC 7208 §5.2, un `include:` que
apunta a un dominio sin SPF devuelve **PermError**, y eso **anula el registro completo**. O sea
que el SPF de encuentravet.cl no ha estado protegiendo nada desde antes de esta migración.

Además, Amazon SES solo usa tu dominio como remitente de sobre si configuras un *MAIL FROM
personalizado*, que requiere un MX en un subdominio. No existe ninguno
(revisé `mail.`, `bounce.` y `correo.`), así que los correos del sitio salen con remitente de
sobre `@amazonses.com` y **el SPF de tu dominio ni siquiera se consulta para ellos**.

Conclusión: `include:amazonses.com` no aporta nada y sí hace daño. El registro correcto es
**`v=spf1 include:zohomail.com -all`**.

**2. Los reportes DMARC no te están llegando.**
El `rua=` apunta a `encuentra.vet@gmail.com`, que es un dominio distinto. La norma (RFC 7489)
exige que el dominio receptor publique una autorización; verifiqué
`encuentravet.cl._report._dmarc.gmail.com` y **no existe** (NXDOMAIN), así que Google, Microsoft
y Yahoo descartan esos reportes. Se arregla apuntando el `rua=` a una casilla del propio dominio.

---

## 2. Zoho Mail vs Google Workspace — para tu caso

Costo real para **una casilla**, que es lo que necesitas:

| | **Zoho Mail Lite** | **Zoho gratis** | **Google Workspace Starter** |
|---|---|---|---|
| **Precio** | USD 1/usuario/mes anual ≈ **$12.000 CLP al AÑO** | **$0** | USD 8,40/mes ≈ **$102.000 CLP al año + IVA** |
| **Usarlo desde Gmail** | ✅ Sí (IMAP/POP/SMTP) | ❌ **No** | ✅ Es Gmail |
| **IMAP / POP / SMTP** | ✅ | ❌ | ✅ |
| **Almacenamiento** | 5 GB (10 GB por USD 1,25) | 5 GB | 30 GB |
| **Usuarios** | Los que quieras, sin mínimo | Hasta 5 | Por licencia |
| **Alias** | ✅ | ✅ | ✅ |
| **Incluye Drive/Meet/Docs** | ❌ | ❌ | ✅ |

Dicho de otra forma: **lo que Google te cobra en un mes, Zoho Lite te lo cobra en un año.**

### Recomendación: **Zoho Mail Lite**

Para 1-3 casillas de correspondencia uno a uno, pagar 8,5 veces más por Google no se justifica.
Lo que realmente decide si tus correos llegan a la bandeja de entrada de Zoetis o Salcobrand no
es la marca del proveedor, sino tener **SPF, DKIM y DMARC bien alineados** — y eso lo vamos a
configurar igual en cualquiera de los dos. La ventaja de entregabilidad de Google existe, pero
es marginal en este uso y pesa sobre todo en envíos masivos, no en responder cotizaciones.

Las funciones de Google que sí valen (Drive, Meet, Docs) ya las tienes gratis en tu cuenta
personal, así que estarías pagando dos veces por lo mismo.

**Por qué Lite y no el plan gratis:** el plan gratuito de Zoho **no incluye IMAP, POP ni SMTP
externo**. Eso significa que quedas encerrado en el webmail y la app de Zoho: no podrías leer ni
responder contacto@encuentravet.cl desde Gmail. Por **USD 12 al año** (~$1.000 CLP al mes)
recuperas exactamente eso y sigues trabajando desde la bandeja de Gmail de siempre.

> El plan gratis es una opción legítima **solo si** aceptas usar la app de Zoho en vez de Gmail.
> Funciona bien y recibe sin problemas; simplemente es otra aplicación.

---

## 3. Configuración paso a paso (Zoho Mail Lite)

### 3.1 Crear la cuenta

1. Entra a **https://www.zoho.com/mail/zohomail-pricing.html** y elige **Mail Lite**
   (5 GB, USD 1/usuario/mes) con facturación **anual**. Cantidad de usuarios: **1**.
2. Regístrate con la opción **"Sign up with a domain I already own"** → `encuentravet.cl`.
3. Elige el centro de datos **US (zoho.com)**: es el que corresponde a Chile y determina los
   valores DNS que verás.
4. Crea el administrador: **contacto@encuentravet.cl**.
5. En el panel: **Panel de administración → Dominios → encuentravet.cl → DNS Mapping**.
   Ahí Zoho te muestra *tus* valores exactos de verificación, MX y DKIM.

### 3.2 Registros a crear en Vercel

En **Domains → encuentravet.cl → DNS Records**. Para el dominio raíz el campo *Name* va
**vacío** (Vercel lo toma como `@`). Pega los valores **sin comillas**.

> **Vercel no permite editar un registro existente**: donde la tabla dice *EDITAR*, hay que
> **borrar el registro viejo y crear el nuevo**. Hazlo en ese orden y seguido — nunca dejes los
> dos SPF conviviendo, porque dos registros SPF se invalidan entre sí.

**Orden recomendado.** Primero los registros 1 y 5 (verificación y SPF); con el dominio ya
verificado y la casilla creada, recién entonces los MX, el DKIM y el DMARC. Así el correo no
se enruta a Zoho antes de que exista el buzón que lo recibe.

| # | Name | Type | Priority | Value | Acción |
|---|---|---|---|---|---|
| 1 | *(vacío)* | TXT | — | `zoho-verification=zb50128109.zmverify.zoho.com` | **Agregar** |
| 2 | *(vacío)* | MX | `10` | `mx.zoho.com` | **Agregar** |
| 3 | *(vacío)* | MX | `20` | `mx2.zoho.com` | **Agregar** |
| 4 | *(vacío)* | MX | `50` | `mx3.zoho.com` | **Agregar** |
| 5 | *(vacío)* | TXT | — | `v=spf1 include:zohomail.com -all` | **EDITAR el SPF existente** |
| 6 | `zmail._domainkey` | TXT | — | *(la clave DKIM del panel, paso 3.3)* | **Agregar** |
| 7 | `_dmarc` | TXT | — | `v=DMARC1; p=quarantine; rua=mailto:dmarc@encuentravet.cl; ruf=mailto:dmarc@encuentravet.cl; fo=1; adkim=r; aspf=r; pct=100` | **EDITAR el DMARC existente** |

**Notas críticas:**

- **Prioridades y selector:** las de arriba son las habituales del centro de datos US, pero
  **copia siempre las que muestre tu panel de DNS Mapping** — Zoho varía la prioridad del tercer
  MX (30 o 50) y el nombre del selector DKIM (`zmail` o `zoho`) según la cuenta.
- **Registro 5 (SPF):** es una **edición del registro existente**, no uno nuevo. Si creas un
  segundo SPF, los dos se invalidan y todo tu correo falla la autenticación. `include:amazonses.com`
  se **elimina** a propósito: apunta a un dominio sin SPF y provoca PermError (ver sección 1).
  Si algún día configuras un MAIL FROM personalizado en SES, ahí sí habría que reincorporarlo.
- **Registro 7 (DMARC):** también es **edición**. Cambiar el `rua` a una dirección del propio
  dominio es lo que hace que por fin te lleguen los reportes.
- **No mezcles proveedores:** si algún día pruebas Google, los MX de Zoho se eliminan primero.
  Dos juegos de MX simultáneos hacen que el correo se pierda de forma intermitente.

### 3.3 Activar DKIM

La clave la emite Zoho, así que este paso va después de crear la cuenta.

1. **Panel de administración → Seguridad del correo → DKIM → encuentravet.cl → Agregar selector**.
2. Selector: `zmail`. Zoho genera el valor `v=DKIM1; k=rsa; p=MIIBIjANBg…`
3. Pégalo en Vercel como el **registro 6** de la tabla (Name: `zmail._domainkey`).
4. Espera la propagación (paso 3.4) y **recién ahí** vuelve al panel y pulsa **Verificar**.
   Si verificas antes de que propague, falla y hay que reintentar.

### 3.4 Verificar la propagación

Antes de apretar "Verificar" en Zoho:

```bash
node scripts/verificar-correo-dns.mjs
```

El script detecta solo si el dominio quedó en Zoho o en Google y revisa el SPF que corresponda.
Deben quedar en verde: MX de Zoho, SPF con `zohomail.com`, DKIM publicado y DMARC.
La propagación toma entre 15 minutos y 2 horas. Equivalente manual:

```bash
dig +short MX  encuentravet.cl
dig +short TXT encuentravet.cl
dig +short TXT zmail._domainkey.encuentravet.cl
dig +short TXT _dmarc.encuentravet.cl
```

### 3.5 Seguir usando Gmail como bandeja única

Esto es lo que compras con el plan Lite. En tu Gmail personal:

- **Recibir:** ⚙️ → **Ver toda la configuración** → **Cuentas e importación** → *Consultar correo
  de otras cuentas* → **Agregar una cuenta de correo** → `contacto@encuentravet.cl`
  → servidor **`pop.zoho.com`**, puerto **995**, **SSL activado**.
- **Enviar:** en la misma pantalla, *Enviar como* → **Agregar otra dirección** →
  `contacto@encuentravet.cl` → servidor **`smtp.zoho.com`**, puerto **465**, **SSL**,
  usuario y contraseña de Zoho.
- **En el celular:** la app de Gmail acepta la cuenta por IMAP (`imap.zoho.com`, puerto 993, SSL).

> **Consejo:** Gmail consulta el POP cada cierto rato y puede demorar hasta una hora. Para que
> el correo te llegue al instante, activa además en Zoho el **reenvío** hacia tu Gmail
> (Configuración → Reenvío de correo). Combinado con *Enviar como*, tienes recepción inmediata
> y respuestas que salen desde contacto@encuentravet.cl con SPF y DKIM correctos.

---

## 3-bis. Si prefieres Google Workspace

Todo lo demás de esta guía (alias, migración, firmas, checklist) aplica igual. Solo cambian los
registros DNS:

| Name | Type | Priority | Value |
|---|---|---|---|
| *(vacío)* | TXT | — | `google-site-verification=XXXXXXXX` |
| *(vacío)* | MX | `1` | `smtp.google.com` ← **un solo MX**, no los antiguos `ASPMX…` |
| *(vacío)* | TXT | — | `v=spf1 include:_spf.google.com -all` |
| `google._domainkey` | TXT | — | clave DKIM de admin.google.com |

Registro en **https://workspace.google.com/business/signup/welcome** (Business Starter, 1 usuario)
y DKIM en **admin.google.com → Aplicaciones → Google Workspace → Gmail → Autenticar correo**
(2048 bits, selector `google`). El dominio ya tiene un `google-site-verification` de Search
Console, así que es probable que la verificación salga inmediata.

---

## 4. Cuentas y alias

**Una sola casilla pagada, tres direcciones.** Los alias son gratis y llegan todos a la misma
bandeja, así que no hay nada que revisar por separado.

| Dirección | Tipo | Costo |
|---|---|---|
| `contacto@encuentravet.cl` | Casilla principal (usuario) | La única licencia pagada |
| `ventas@encuentravet.cl` | Alias de contacto@ | $0 |
| `marketing@encuentravet.cl` | Alias de contacto@ | $0 |
| `dmarc@encuentravet.cl` | Alias de contacto@ (reportes) | $0 |

**Cómo crearlos en Zoho:** Panel de administración → **Usuarios** → contacto@ → **Alias de
correo** → agregar las tres. No consumen licencia.
*(En Google sería: admin.google.com → Directorio → Usuarios → contacto@ → Direcciones de correo
alternativas.)*

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

### 5.2 Bandeja combinada

Con el plan Lite todo converge en la bandeja de Gmail que ya usas (paso 3.5): el correo nuevo
de `contacto@` entra ahí por POP o por reenvío, y respondes desde esa misma dirección vía SMTP
de Zoho. No tienes que revisar dos aplicaciones.

Si en cambio te quedas en el webmail de Zoho, agrega ahí el Gmail antiguo:
**Configuración → Correo → Cuentas externas → Agregar cuenta POP**, y también
**Enviar como** la dirección antigua para responder manteniendo el hilo.

### 5.3 Plan de transición sugerido

| Momento | Acción |
|---|---|
| Semana 1 | Reenvío activo. Firma nueva en todos los correos. |
| Semanas 1-4 | Responder siempre **desde** contacto@ (aunque el mensaje haya llegado al Gmail viejo): entrena a tus contactos. |
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

- [x] Cuenta creada con `contacto@encuentravet.cl` (Zoho Mail Lite, facturación anual)
- [x] TXT de verificación agregado en Vercel y **dominio verificado** en el panel
- [x] Los 3 MX de Zoho cargados — 10/20/50, sin MX de otro proveedor
- [x] SPF **editado** a `v=spf1 include:zohomail.com -all` — un registro, includes válidos, 2/10 consultas
- [x] DKIM publicado en `zmail._domainkey` — clave RSA de 1024 bits validada criptográficamente
- [ ] Gmail configurado para recibir (POP) y enviar (SMTP) como contacto@
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
