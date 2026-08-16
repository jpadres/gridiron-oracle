/**
 * Configuración de Next.js.
 *
 * Las cabeceras de seguridad de aquí se verifican en CI **contra el servidor
 * real**, no leyendo este fichero. Es una distinción que importa: un config
 * puede ser correcto y no aplicarse (una ruta que no pasa por el middleware, un
 * `output` que cambia el pipeline), y entonces la comprobación mira el sitio
 * equivocado. Ver `.github/workflows/ci.yml`.
 *
 * La CSP no lista ni un dominio externo, y puede permitírselo porque el sitio no
 * carga nada de fuera: sin fuentes de Google, sin analítica, sin CDN. Los datos
 * viajan dentro del bundle (ver `data/model.js`), así que tampoco hay
 * `connect-src` que abrir.
 */

const CSP = [
  "default-src 'self'",
  // Next.js inyecta el bootstrap de hidratación como script inline; sin
  // 'unsafe-inline' la página no arranca. No se usa 'unsafe-eval'.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  // Cero peticiones de red en runtime: nada que permitir.
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Dos años con includeSubDomains y preload: los requisitos de la lista de
  // precarga de HSTS.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sin `X-Powered-By`: no hay motivo para anunciar la versión del framework.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
