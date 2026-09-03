/**
 * La página de apuestas: lo que se publica y lo que ya NO se publica.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { gameLeans } from "../app/betting/leans.js";

/* ── el modelo de totales, retirado ──────────────────────────────────────
   Se quitó el 3 de septiembre de 2026 con la medición delante: sobre 3.829
   partidos fuera de muestra su MAE era PEOR que el de la línea a secas
   (10,574 contra 10,510; diferencia pareada +0,064 ± 0,019) y su señal de
   over/under acertaba el 47,8% cuando se separaba más de un punto, con el
   equilibrio a -110 en 52,4%. Este test existe para que no vuelva sin su
   medición: si alguien reintroduce un lean de totales, se pone rojo. */
test("no se publica ningún lean de totales", () => {
  const rows = gameLeans([
    {
      game_id: "2026_01_A_B", home_team: "A", away_team: "B",
      spread_line: 3, pred_margin: 5.5,
      total_line: 44.5, pred_total: 48.0,   // discrepancia enorme a propósito
    },
  ]);
  assert.equal(rows.filter((r) => r.family === "TOTAL").length, 0);
  // El de spread sí sigue: ése no se retiró.
  assert.equal(rows.filter((r) => r.family === "SPREAD").length, 1);
});
