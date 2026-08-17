import "./globals.css";

export const metadata = {
  title: "Gridiron Oracle",
  description:
    "Modelo de pronóstico NFL y rankings de fantasy sobre datos públicos, con validación walk-forward y resultados reportados sin maquillaje.",
};

// Las siete páginas del sitio. Todas estáticas, con los datos horneados.
const PAGES = [
  { href: "/", label: "Resumen" },
  { href: "/modelo", label: "Modelo" },
  { href: "/validacion", label: "Validación" },
  { href: "/predicciones", label: "Predicciones" },
  { href: "/fantasy", label: "Draft" },
  { href: "/fantasy/semanal", label: "Semanal" },
  { href: "/research", label: "Research" },
];

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
          </footer>
        </div>
      </body>
    </html>
  );
}
