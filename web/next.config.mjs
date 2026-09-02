/**
 * Configuración de Next.js.
 *
 * Las cabeceras de seguridad de aquí se verifican en CI **contra el servidor
 * real**, no leyendo este fichero. Es una distinción que importa: un config
 * puede ser correcto y no aplicarse (una ruta que no pasa por el middleware, un
 * `output` que cambia el pipeline), y entonces la comprobación mira el sitio
 * equivocado. Ver `.github/workflows/ci.yml`.
 *
 * La CSP no lista ni un dominio externo para **cargar** nada: sin fuentes de
 * Google, sin analítica, sin CDN. Los datos viajan dentro del bundle (ver
 * `data/model.js`).
 *
 * La única excepción es `connect-src`, y está ahí a petición explícita del
 * dueño: el modo draft consulta los picks de su liga de Sleeper en vivo para
 * tachar solo a quien ya se llevaron. Sin eso hay que ir marcando 250 nombres a
 * mano en un móvil mientras corre el reloj del pick, que es cuando menos manos
 * libres tienes.
 *
 * Lo que se paga por ello, dicho sin adornos: **el sitio deja de ser cero-red en
 * runtime**, y el pie de página lo dice. La API de Sleeper es pública y de sólo
 * lectura —sin clave, sin OAuth, nada que rotar— así que no viaja ninguna
 * credencial al navegador; lo que sí sale de aquí es el id de tu liga, que ya es
 * público en la URL de Sleeper.
 */

const CSP = [
  "default-src 'self'",
  // Next.js inyecta el bootstrap de hidratación como script inline; sin
  // 'unsafe-inline' la página no arranca. No se usa 'unsafe-eval'.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Las fotos de los jugadores, por `sleeper_id`, desde el CDN de Sleeper. Es
  // el SEGUNDO dominio externo y sólo puede estar aquí: CI comprueba que la
  // CSP lista exactamente estos dos, cada uno en su directiva.
  "img-src 'self' data: https://sleepercdn.com",
  "font-src 'self'",
  // Sleeper y nada más. `connect-src` es una lista blanca: cualquier otro
  // destino sigue bloqueado por el navegador, así que un fallo o una dependencia
  // que intentara llamar a otro sitio no llegaría a salir.
  "connect-src 'self' https://api.sleeper.app",
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
