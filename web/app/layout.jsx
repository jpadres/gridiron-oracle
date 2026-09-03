import "./globals.css";
// DESPUÉS de globals.css a propósito: `system.css` redirige los tokens de la
// Fase 1 a la paleta de campo, y para eso tiene que ganar la cascada.
import "./system.css";

// El color de la barra del navegador en móvil. Sin esto, Safari y Chrome pintan
// su propio gris encima de la cabecera y el sitio parece recortado.
export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#101216" },
  ],
};

export const metadata = {
  title: "Gridiron Oracle",
  description:
    "NFL forecasting model and fantasy rankings built on public data, with walk-forward validation and results reported without spin.",
};

// Las ocho páginas del sitio. Todas estáticas, con los datos horneados.
const PAGES = [
  { href: "/", label: "Overview" },
  { href: "/modelo", label: "Model" },
  { href: "/validacion", label: "Validation" },
  { href: "/predicciones", label: "Predictions" },
  { href: "/betting", label: "Betting" },
  // «Draft» y «Room» no decían qué hacía cada una: las dos son del draft y una
  // se llamaba por su mueble. Ahora se nombran por su trabajo — el board es
  // valor por liga, el asistente es la pantalla que se mira DURANTE el draft.
  { href: "/fantasy", label: "Board" },
  { href: "/fantasy/draft", label: "Draft Assistant" },
  { href: "/fantasy/leagues", label: "Leagues" },
  { href: "/fantasy/semanal", label: "Weekly" },
  { href: "/fantasy/analisis", label: "Analyzer" },
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
  const built = new Date().toLocaleString("en-US", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false,
  });
  return (
    <p className="build">
      Build <code>{sha ? sha.slice(0, 7) : "local"}</code> · built {built} UTC
    </p>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* Primer tabulador de la página. Sin esto, llegar al contenido con
            teclado exige pasar por los ocho enlaces del menú en cada carga. */}
        <a className="skip" href="#contenido">Skip to content</a>
        <div className="shell">
          <nav className="top" aria-label="Sections">
            <span className="brand">Gridiron Oracle</span>
            {PAGES.map((page) => (
              <a key={page.href} href={page.href}>
                {page.label}
              </a>
            ))}
          </nav>
          <main id="contenido" tabIndex={-1}>{children}</main>
          <footer>
            <p>
              Data from nflverse (public domain). Code under the MIT license. A sports
              research and analysis project: none of this is financial advice, and betting
              carries a risk of loss.
            </p>
            <p>
              Static site: no accounts, no database. The only network requests at runtime
              go to Sleeper: its public API for the draft sync and the linked-account view on
              Leagues, only if you turn them on, and its CDN for player photos on the fantasy
              pages. Nothing else is requested.
            </p>
            <BuildStamp />
          </footer>
        </div>
      </body>
    </html>
  );
}
