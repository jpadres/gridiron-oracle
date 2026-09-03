/**
 * Lo que la liga permite decir sin inventar un consejo, y el resto de temporada.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  GAMES_IN_SEASON, freeAgentUpgrades, freeSpecialists, gameWeeksLeft, restOfSeason,
} from "../app/fantasy/leagueAdvice.js";

const BYES = { LAR: 7, KC: 10, BUF: 7 };

test("las jornadas que quedan descuentan el descanso sólo si está por delante", () => {
  assert.equal(gameWeeksLeft({ team: "LAR", week: 1, byes: BYES }), 17);
  assert.equal(gameWeeksLeft({ team: "LAR", week: 7, byes: BYES }), 11); // 7..18 = 12, menos el suyo
  assert.equal(gameWeeksLeft({ team: "LAR", week: 8, byes: BYES }), 11); // ya pasó
  assert.equal(gameWeeksLeft({ team: "KC", week: 8, byes: BYES }), 10);  // 11 semanas, descanso por venir
});

test("sin descanso conocido no se estima: null", () => {
  assert.equal(gameWeeksLeft({ team: "XXX", week: 1, byes: BYES }), null);
  assert.equal(gameWeeksLeft({ team: "LAR", week: 0, byes: BYES }), null);
  assert.equal(gameWeeksLeft({ team: "LAR", week: 19, byes: BYES }), null);
});

test("en la jornada 1 el ROS es la proyección de temporada y el orden es el del board", () => {
  const board = [
    { player_id: "a", team: "LAR", position: "WR", projected_points: 240, vor: 90 },
    { player_id: "b", team: "KC", position: "WR", projected_points: 200, vor: 60 },
  ];
  const ros = restOfSeason({ board, byes: BYES, week: 1 });
  assert.equal(ros[0].player_id, "a");
  assert.equal(Math.round(ros[0].ros_points), 240);
  assert.equal(Math.round(ros[0].ros_vor), 90);
  assert.equal(ros[0].ros_rank, 1);
  assert.equal(ros[0].ros_position_rank, 1);
  assert.equal(ros[1].ros_position_rank, 2);
});

test("SE ORDENA POR VALOR, NO POR PUNTOS (regla 6b)", () => {
  // El fallo real: ordenando por puntos salieron 52 quarterbacks en el top 60
  // y el primer receptor en el 13. Un quarterback suma más y su reemplazo
  // también, así que los puntos no ordenan entre posiciones.
  const board = [
    { player_id: "qb", team: "LAR", position: "QB", projected_points: 280, vor: 20 },
    { player_id: "wr", team: "LAR", position: "WR", projected_points: 210, vor: 95 },
  ];
  const ros = restOfSeason({ board, byes: BYES, week: 1 });
  assert.equal(ros[0].player_id, "wr");
  // Y el quarterback sigue teniendo MÁS puntos en su fila: la tabla enseña los
  // dos números, no esconde el que no ordena.
  assert.ok(ros[1].ros_points > ros[0].ros_points);
});

test("el descanso por delante cambia el orden entre dos casi iguales", () => {
  const board = [
    { player_id: "conBye", team: "KC", position: "RB", projected_points: 170, vor: 60.5 },
    { player_id: "sinBye", team: "LAR", position: "RB", projected_points: 168, vor: 60 },
  ];
  const week1 = restOfSeason({ board, byes: BYES, week: 1 });
  assert.equal(week1[0].player_id, "conBye"); // en la 1 manda el board
  const week8 = restOfSeason({ board, byes: BYES, week: 8 });
  // En la 8 al de KC le queda su descanso y al de LAR ya se le pasó.
  assert.equal(week8[0].player_id, "sinBye");
  assert.equal(week8[0].ros_games_left, 11);
  assert.equal(week8[1].ros_games_left, 10);
});

test("sin descanso conocido no hay ROS y la fila cae al final, sin puesto", () => {
  const board = [
    { player_id: "raro", team: "XXX", position: "WR", projected_points: 400, vor: 300 },
    { player_id: "normal", team: "LAR", position: "WR", projected_points: 100, vor: 10 },
  ];
  const ros = restOfSeason({ board, byes: BYES, week: 3 });
  assert.equal(ros[0].player_id, "normal");
  assert.equal(ros[1].ros_points, null);
  assert.equal(ros[1].ros_vor, null);
  assert.equal(ros[1].ros_rank, null);
});

test("GAMES_IN_SEASON son 17: 18 jornadas menos el descanso", () => {
  assert.equal(GAMES_IN_SEASON, 17);
});

/* ── agentes libres ──────────────────────────────────────────────────────── */

const OWN = (map) => (row) => (map[row.player_id] ? { status: map[row.player_id] } : null);

test("sólo se emite el par cuando el libre proyecta MÁS que mi más flojo", () => {
  const rows = [
    { player_id: "mio1", position: "WR", projected_points: 14 },
    { player_id: "mio2", position: "WR", projected_points: 9 },
    { player_id: "libre", position: "WR", projected_points: 12.5 },
    { player_id: "otro", position: "WR", projected_points: 20 },
  ];
  const own = OWN({ mio1: "MINE", mio2: "MINE", libre: "FREE_AGENT", otro: "TAKEN" });
  const [gap, ...rest] = freeAgentUpgrades({ rows, own });
  assert.equal(rest.length, 0);
  assert.equal(gap.position, "WR");
  assert.equal(gap.free.player_id, "libre");
  // Contra el MÁS FLOJO de los míos, no contra el mejor.
  assert.equal(gap.weakest.player_id, "mio2");
  assert.equal(Math.round(gap.delta * 10) / 10, 3.5);
  // Un jugador de otro equipo NUNCA entra: no se puede fichar.
  assert.equal(gap.free.player_id !== "otro", true);
});

test("si mi más flojo gana a todos los libres no se dice nada", () => {
  const rows = [
    { player_id: "mio", position: "TE", projected_points: 11 },
    { player_id: "libre", position: "TE", projected_points: 8 },
  ];
  assert.deepEqual(freeAgentUpgrades({ rows, own: OWN({ mio: "MINE", libre: "FREE_AGENT" }) }), []);
});

test("las diferencias de décimas no llenan la lista", () => {
  const rows = [
    { player_id: "mio", position: "RB", projected_points: 10 },
    { player_id: "libre", position: "RB", projected_points: 10.4 },
  ];
  assert.deepEqual(freeAgentUpgrades({ rows, own: OWN({ mio: "MINE", libre: "FREE_AGENT" }) }), []);
});

test("sin liga (own devuelve null) no hay nada que comparar", () => {
  const rows = [{ player_id: "x", position: "RB", projected_points: 10 }];
  assert.deepEqual(freeAgentUpgrades({ rows, own: () => null }), []);
});

test("los pares salen ordenados por diferencia", () => {
  const rows = [
    { player_id: "m1", position: "RB", projected_points: 5 },
    { player_id: "f1", position: "RB", projected_points: 9 },
    { player_id: "m2", position: "WR", projected_points: 5 },
    { player_id: "f2", position: "WR", projected_points: 15 },
  ];
  const own = OWN({ m1: "MINE", m2: "MINE", f1: "FREE_AGENT", f2: "FREE_AGENT" });
  assert.deepEqual(freeAgentUpgrades({ rows, own }).map((g) => g.position), ["WR", "RB"]);
});

test("pateadores libres por proyección; defensas libres por total implícito del rival", () => {
  const kickers = [
    { player_id: "k1", projected_points: 7 },
    { player_id: "k2", projected_points: 9 },
    { player_id: "k3", projected_points: 12 },
  ];
  const defenses = [
    { team: "AAA", opponent_implied: 24 },
    { team: "BBB", opponent_implied: 17 },
    { team: "CCC", opponent_implied: 19 },
  ];
  const own = (row) => {
    const id = row.player_id ?? row.team;
    return { status: id === "k3" || id === "CCC" ? "TAKEN" : "FREE_AGENT" };
  };
  const free = freeSpecialists({ kickers, defenses, own });
  // El mejor libre, no el mejor: k3 lo tiene alguien.
  assert.deepEqual(free.kickers.map((k) => k.player_id), ["k2", "k1"]);
  // De MENOS a MÁS: un rival que se espera que puntúe poco es la buena señal.
  assert.deepEqual(free.defenses.map((d) => d.team), ["BBB", "AAA"]);
});

test("sin nadie libre las listas salen vacías, no se rellenan con los de otros", () => {
  const own = () => ({ status: "TAKEN" });
  const free = freeSpecialists({ kickers: [{ player_id: "k", projected_points: 9 }], defenses: [{ team: "A", opponent_implied: 1 }], own });
  assert.deepEqual(free.kickers, []);
  assert.deepEqual(free.defenses, []);
});
