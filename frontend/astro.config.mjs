// @ts-check
import { defineConfig } from "astro/config";

// En desarrollo la interfaz corre en :4321 y la API (FastAPI) en otro puerto.
// Este proxy mantiene el "mismo origen" que tenía la app original:
// las llamadas a /api/... se reenvían a la API.
//   API_URL=http://192.168.1.50:8000 npm run dev
const API_URL = process.env.API_URL ?? "http://localhost:8000";

export default defineConfig({
  vite: {
    server: {
      proxy: { "/api": API_URL },
    },
  },
});
