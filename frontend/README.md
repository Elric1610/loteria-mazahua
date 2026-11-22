# Lotería Mazahua (Astro)

Requiere Node 22.22 o superior.

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # genera dist/
npm run preview
```

## API

La app original asumía que la API (`/api/netfly/...`) estaba en el mismo origen.
Se mantiene así:

- **Desarrollo:** `astro.config.mjs` reenvía `/api` a `http://localhost:8000`.
  Para otro destino: `API_URL=http://IP:8000 npm run dev`
- **Producción (Netlify):** descomenta el bloque `[[redirects]]` de `netlify.toml`
  y pon la URL de tu backend. Alternativa: `PUBLIC_API_BASE` en `.env`
  (el backend tendría que permitir CORS).

## Estructura

```
public/                 imagenes/, tableros/, audio_espanol/, audio_mazahua/
src/layouts/Layout.astro
src/pages/index.astro
src/components/         Menu, Wait, Game, Panels, Toasts, Sprite, Icon
src/scripts/app.js      lógica del juego (la misma de antes)
src/styles/global.css   estilos (los mismos de antes)
src/data/               loteria_mazahua.json (export de phpMyAdmin; la app no lo usa)
```
