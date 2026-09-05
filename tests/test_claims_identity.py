"""Identidad de las afirmaciones: se resuelve por el índice canónico o NO se resuelve."""
from __future__ import annotations

import itertools
import random

from oracle.narrative.claims import claim_from_item, coverage, link, resolve_identities
from oracle.narrative.matching import (
    IDENTITY_AMBIGUOUS,
    IDENTITY_NO_TEAM,
    IDENTITY_RESOLVED,
    IDENTITY_UNRESOLVED,
)

BOARD = [
    {"player_id": "BIJ", "player_name": "B.Robinson", "player_full_name": "Bijan Robinson", "team": "ATL"},
    {"player_id": "BRI", "player_name": "B.Robinson", "player_full_name": "Brian Robinson", "team": "ATL"},
    {"player_id": "JWI_DET", "player_name": "J.Williams", "player_full_name": "Jameson Williams", "team": "DET"},
    {"player_id": "JWI_DAL", "player_name": "J.Williams", "player_full_name": "Javonte Williams", "team": "DAL"},
    {"player_id": "ARS", "player_name": "A.St. Brown", "player_full_name": "Amon-Ra St. Brown", "team": "DET"},
    {"player_id": "OBJ", "player_name": "O.Beckham", "player_full_name": "Odell Beckham Jr.", "team": "MIA"},
    {"player_id": "KWA", "player_name": "K.Walker", "player_full_name": "Kenneth Walker", "team": "SEA"},
    {"player_id": "ROOK", "player_name": "A.Jeanty", "player_full_name": "Ashton Jeanty", "team": "LV"},
]


def _claim(players, team, ids=()):
    return claim_from_item({"team": team, "players": list(players), "player_ids": list(ids), "kind": "injury",
                            "headline": "x", "published_at": "2026-09-01", "sources": []})


def test_the_two_robinsons_are_ambiguous_not_guessed():
    c = _claim(["B.Robinson"], "ATL")
    resolve_identities([c], BOARD)
    assert c.player_id is None and c.identity_status == IDENTITY_AMBIGUOUS
    assert not c.product_linked


def test_a_full_name_picks_the_right_robinson():
    c = _claim(["Bijan Robinson"], "ATL")
    resolve_identities([c], BOARD)
    assert (c.player_id, c.identity_status) == ("BIJ", IDENTITY_RESOLVED)
    assert c.product_linked


def test_j_williams_resolves_per_team_and_not_across_teams():
    det = _claim(["J.Williams"], "DET"); dal = _claim(["J.Williams"], "DAL"); nyg = _claim(["J.Williams"], "NYG")
    resolve_identities([det, dal, nyg], BOARD)
    assert det.player_id == "JWI_DET" and dal.player_id == "JWI_DAL"
    assert nyg.player_id is None and nyg.identity_status == IDENTITY_UNRESOLVED


def test_a_team_change_does_not_resolve_against_the_old_team():
    c = _claim(["Kenneth Walker"], "KC")   # traspasado: el board aún lo tiene en SEA
    resolve_identities([c], BOARD)
    assert c.player_id is None and c.identity_status == IDENTITY_UNRESOLVED


def test_suffixes_hyphens_and_accents_resolve_deterministically():
    a = _claim(["Odell Beckham Jr."], "MIA"); b = _claim(["Odell Beckham"], "MIA")
    c = _claim(["Amon-Ra St. Brown"], "DET"); d = _claim(["Amon Ra St Brown"], "DET")
    resolve_identities([a, b, c, d], BOARD)
    assert a.player_id == "OBJ" and c.player_id == "ARS"
    # Sin el sufijo, el nombre completo sigue siendo el MISMO (Jr./Sr./III se
    # quitan a los dos lados): se resuelve. Sin el guion, «Amon Ra» parte el
    # nombre de pila en dos y la clave ya no es la misma: NO se resuelve, que
    # es lo conservador — parecerse no es ser.
    assert b.player_id == "OBJ"
    assert d.player_id is None and d.identity_status == IDENTITY_UNRESOLVED


def test_a_rookie_on_the_board_resolves_like_anyone():
    c = _claim(["Ashton Jeanty"], "LV")
    resolve_identities([c], BOARD)
    assert c.player_id == "ROOK"


def test_no_team_means_no_context_and_no_match():
    c = _claim(["Bijan Robinson"], None)
    resolve_identities([c], BOARD)
    assert c.player_id is None and c.identity_status == IDENTITY_NO_TEAM


def test_ids_from_the_sweep_are_kept_and_team_claims_have_no_subject():
    c = _claim(["Bijan Robinson"], "ATL", ids=["BIJ"])
    t = _claim([], "ATL")
    resolve_identities([c, t], BOARD)
    assert c.player_id == "BIJ" and c.identity_status == IDENTITY_RESOLVED
    assert t.identity_status == "NO_SUBJECT" and t.player_id is None


def test_unresolved_claims_still_exist_and_still_count():
    c = _claim(["Someone Unknown"], "ATL")
    resolve_identities([c], BOARD)
    cov = coverage([c])
    assert cov["claims"] == 1 and cov["product_linked"] == 0
    assert cov["identity"] == {IDENTITY_UNRESOLVED: 1}


def test_only_resolved_ids_chain_claims_and_ambiguous_ones_never_supersede_each_other():
    a = _claim(["Bijan Robinson"], "ATL"); a.published_at = "2026-09-01"
    b = _claim(["Bijan Robinson"], "ATL"); b.published_at = "2026-09-02"
    x = _claim(["B.Robinson"], "ATL"); x.published_at = "2026-09-03"
    resolve_identities([a, b, x], BOARD)
    link([a, b, x])
    assert b.supersedes == a.claim_id
    # el ambiguo se encadena por nombre@equipo con sus iguales, nunca con Bijan
    assert x.supersedes is None


def _variants(name: str):
    base = [name, name.upper(), name.lower(), name.replace(".", ""), name.replace("-", " "),
            name + " Jr.", name + " III", "  " + name + "  ", name.replace("é", "e")]
    return base


def test_fuzz_name_variations_only_resolve_to_the_same_player_or_nothing():
    rng = random.Random(7)
    names = {"Bijan Robinson": "BIJ", "Jameson Williams": "JWI_DET", "Amon-Ra St. Brown": "ARS",
             "Kenneth Walker": "KWA", "Odell Beckham Jr.": "OBJ"}
    teams = {"BIJ": "ATL", "JWI_DET": "DET", "ARS": "DET", "KWA": "SEA", "OBJ": "MIA"}
    for name, pid in names.items():
        for variant in _variants(name):
            c = _claim([variant], teams[pid])
            resolve_identities([c], BOARD)
            assert c.player_id in (pid, None), (variant, c.player_id)
    # y contra el equipo equivocado, NUNCA
    for name, pid in names.items():
        for _ in range(20):
            wrong = rng.choice([t for t in ("ATL", "DET", "SEA", "MIA", "LV", "DAL", "KC") if t != teams[pid]])
            c = _claim([name], wrong)
            resolve_identities([c], BOARD)
            assert c.player_id != pid or c.identity_status != IDENTITY_RESOLVED or teams[pid] == wrong
    # y las claves abreviadas con colisión siguen ambiguas en cualquier grafía
    for variant in itertools.chain(_variants("B.Robinson"), _variants("B. Robinson")):
        c = _claim([variant], "ATL")
        resolve_identities([c], BOARD)
        assert c.player_id is None, variant
