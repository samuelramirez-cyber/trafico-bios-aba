# Dashboard de Tráfico — Grupo Bios ABA

Fuente: pestaña **OT 2026** del Sheet de OTs, servida por Apps Script con filtro en servidor
`CLIENTE = GRUPO BIOS ABA`. La hoja permanece privada; el sitio público solo recibe filas de ABA.

PWA estática (HTML + JS ES6 en módulos + Tailwind/Chart.js por CDN). No necesita backend ni build.

```
dashboard-trafico/
├─ index.html            UI (KPIs, filtros, gráfico de estados, tabla)
├─ app.js                estado de filtros, carga y render reactivo
├─ config.js             ← ÚNICO archivo a editar (Sheet, pestañas, filtro de cliente, caché, estados)
├─ styles.css            componentes base
├─ js/connector.js       ingesta: CSV export / Apps Script, timeout, reintentos, caché localStorage
├─ js/normalize.js       CSV, encabezados, fechas → DD/MM/YYYY, OT, filtro de cliente, estado
├─ js/filters.js         motor temporal (Mes / Trimestre / Semestre / Año) y KPIs
├─ js/charts.js · js/table.js · js/ui.js
├─ sw.js · manifest.webmanifest   PWA (abre sin red con el último caché)
├─ apps-script/DashboardApi.gs    API opcional si el Sheet debe seguir privado
├─ data/sample.csv       datos demo (se usan mientras SHEET_ID esté vacío)
└─ tests/core.test.mjs
```

## 1. Conectar el Sheet (seguro)

1. Abrir https://script.new con la cuenta que tiene acceso a la hoja y pegar `apps-script/DashboardApi.gs`.
2. Poner el ID de la hoja en `SHEET_ID` (de `docs.google.com/spreadsheets/d/<ID>/edit`) y guardar.
3. **Implementar → Nueva implementación → Aplicación web**: *Ejecutar como: Yo* · *Quién tiene acceso: Cualquier usuario*. Autorizar.
4. Copiar la URL `.../exec` en `APPS_SCRIPT_URL` de `config.js`.
5. Dejar la hoja en **Acceso general: Restringido** (sin "cualquier persona con el enlace").

Qué queda expuesto: solo las filas de GRUPO BIOS ABA (encabezado + OTs), a quien tenga la URL del dashboard.
El ID de la hoja vive solo dentro del script, no en este repositorio.

Modo `csv` (solo pruebas locales): `SOURCE: 'csv'` + `SHEET_ID`, con la hoja compartida por enlace.

## 2. Ejecutar en Windows (local)

Los módulos ES requieren servirse por HTTP (no abrir `index.html` con doble clic). Desde PowerShell:

```powershell
cd "C:\Users\Administrador\Desktop\APK BIOS\dashboard-trafico"
python -m http.server 8090 --bind 127.0.0.1
```

Abrir http://localhost:8090. Alternativa sin Python: `npx serve -l 8090`.

Pruebas del parser y filtros (Node 18+):

```powershell
node --test tests/core.test.mjs
```

Para publicarlo (p. ej. Netlify, como la Misión #1) basta arrastrar la carpeta completa; el service worker requiere HTTPS o localhost.

## 3. Comportamiento

| Tema | Regla |
|---|---|
| Encabezados | Se buscan en las primeras 30 filas. Alias sin tildes/mayúsculas (`GERENTE / DIRECTOR`, `RESPONSABLE 1/2`, `FECHA INGRESO`…). La columna de OT sin título (col. A) se detecta por su formato `000123`. |
| Cliente | Solo se procesan filas con CLIENTE en `CLIENT_FILTER` (hoy `GRUPO BIOS ABA`; excluye ABS, PIC y `GRUPO BIOS`). |
| OT / descripción | `000010` → `OT 000010`; `ot_000010_aba_ajuste_empaque` → "Ajuste empaque". |
| Fechas | Acepta `DD/MM/YYYY`, `04/05 /2026` (espacios sobrantes), `D-M-YY`, `YYYY-MM-DD`, `15-mar-2026`, `15 de marzo de 2026`, serial Excel. Se valida que la fecha exista (31/02 → error). Si el mes es > 12 y el día ≤ 12 se invierten y se reporta como advertencia. `-`, `N/A`, `PENDIENTE` = sin fecha. |
| Estado | Columna ESTADO clasificada con `STATUSES` (config.js): Entregado, En proceso, En revisión, En reproceso, No realizado. Vacío o desconocido → "Sin estado". Las tarjetas KPI se generan desde esa lista. |
| Filtros | Fecha base INGRESO o ENTREGA; rangos semiabiertos [inicio, fin). Año = calendario. Todos los filtros (periodo, gerente, responsable 1 o 2, estado, búsqueda) afectan KPIs, gráficos y tabla. OTs sin fecha en el campo base quedan fuera del periodo y se informan en "Calidad de datos". |
| Caché | `localStorage`, TTL `CACHE_TTL_MIN` (5 min). Refresco automático cada `AUTO_REFRESH_MIN` solo con la pestaña visible; "Actualizar" fuerza la consulta. |
| Fallos | Timeout 15 s, 3 reintentos con backoff (1/2/4 s) en errores de red/5xx/429. Si falla, se muestran los últimos datos en caché con aviso y botón Reintentar. |

Filas omitidas: sin OT, encabezados repetidos y filas `TOTAL`/`SUBTOTAL`.

## 4. Seguimiento semanal (Cuadro Tango)

Fuente: libro "CUADRO TANGO – GRUPO BIOS", una pestaña por semana (`1 SEPT`, `6 OCTUBRE`…), la mayoría ocultas
(histórico desde abr-2024). El estado de cada OT es el **color de la celda "No"**, interpretado con la leyenda de la propia pestaña.

- `apps-script/Semanal.gs` (mismo proyecto Apps Script): `?view=pestanas` lista las semanas (incluidas ocultas; el año se
  infiere por el orden de las pestañas y tolera nombres como `2 SPETIEMBRE` o `10 JUNIO 26`); `?view=semana&gid=N` devuelve una semana.
- El dashboard carga las últimas `WEEKS_INITIAL` semanas + todas las ya guardadas en el navegador; "Cargar histórico completo"
  descarga el resto una sola vez (las ocultas no cambian y se guardan sin vencimiento).
- Balance semana vs anterior: nuevas, cambios de estado, pasaron a aprobado, estancadas (≥ `STALE_WEEKS`), salieron, evolución.
- Cruce con OT's TANGO 2026 por el código `ot_XXXXXX_…` (= DESCRIPCIÓN). "Discrepancias": aprobado en el cuadro pero no
  entregado en OT 2026, o al revés. El formato antiguo (`OT 000539 GRUPO BIOS …`) no cruza: los números se repiten entre años.
- Colores fuera de la leyenda → `CUADRO_COLORES` en config.js (p. ej. `'#34a853': 'APROBADO'`).
- Tras editar los `.gs`: pegar en el proyecto (SHEET_ID / CUADRO_ID reales solo allí) → Implementar → Gestionar → Editar → Versión nueva.
