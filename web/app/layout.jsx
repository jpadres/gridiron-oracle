import "./globals.css";

export const metadata = {
  title: "Gridiron Oracle",
  description:
    "Modelo de pronóstico NFL y rankings de fantasy sobre datos públicos, con validación walk-forward y resultados reportados sin maquillaje.",
};

// Las ocho páginas del sitio. Todas estáticas, con los datos horneados.
const PAGES = [
  { href: "/", label: "Resumen" },
  { href: "/modelo", label: "Modelo" },
  { href: "/validacion", label: "Validación" },
  { href: "/predicciones", label: "Predicciones" },
  { href: "/fantasy", label: "Draft" },
  { href: "/fantasy/semanal", label: "Semanal" },
  { href: "/survivor", label: "Survivor" },
  { href: "/research", label: "Research" },
];

/**
 * Sello de build: qué commit sirve esta página y cuándo se horneó.
 *
 * No es telemetría ni adorno. Sin esto, «no veo lo nuevo» y «lo estoy viendo
 * cacheado» son indistinguibles desde fuera — y esa duda costó tres rondas de
 * verificación contra la API de Vercel sin poder concluir nada, porque el
 * servidor y el navegador estaban mirando cosas distintas y la página no decía
 * cuál. Es el mismo motivo por el que las tarjetas de la portada llevan la
 * fecha del último barrido: un dato que no dice de cuándo es no sirve para
 * decidir.
 *
 * Aquí SÍ va un reloj de pared, al revés que en `out/research.json`, donde se
 * quitó a propósito. La diferencia es que aquel fichero **se versiona** y su
 * marca de tiempo hacía que el payload cambiase cada día aunque el contenido
 * fuese idéntico, llenando el repo de commits de ruido. Esto no se versiona: se
 * calcula en cada build y muere en el HTML generado. No hay nada que ensuciar.
 *
 * Las variables las pone Vercel en build time. En local no existen y sale
 * «local», que es exactamente lo que hay que ver en local.
 */
function BuildStamp() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const built = new Date().toLocaleString("es-ES", {
    day: "numeric", month: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });
  return (
    <p className="build">
      Build <code>{sha ? sha.slice(0, 7) : "local"}</code> · horneado el {built} UTC
    </p>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <div className="shell">
          <nav className="top">
            <span className="brand">Gridiron Oracle</span>
            {PAGES.map((page) => (
              <a key={page.href} href={page.href}>
                {page.label}
              </a>
            ))}
          </nav>
          <main>{children}</main>
          <footer>
            <p>
              Datos de nflverse (dominio público). Código bajo licencia MIT. Proyecto de
              investigación y análisis deportivo: nada de esto es una recomendación
              financiera, y las apuestas conllevan riesgo de pérdida.
            </p>
            <p>
              Sitio estático: sin cuentas, sin base de datos y sin peticiones de red en
              runtime.
            </p>
            <BuildStamp />
          </footer>
        </div>
      </body>
    </html>
  );
}
