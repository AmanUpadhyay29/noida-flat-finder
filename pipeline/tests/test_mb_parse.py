import pathlib
import mb_parse

FX = pathlib.Path(__file__).parent / "fixtures"


def read(name):
    return (FX / name).read_text(encoding="utf-8", errors="ignore")


def test_list_page():
    h = read("mb_list.html")
    cards = mb_parse.parse_list_page(h)
    assert len(cards) == 20
    assert mb_parse.parse_total(h) == 2708
    p = mb_parse.card_to_project(cards[0])
    assert p["name"] == "Solutrean Gateway95"
    assert p["url"].startswith("https://www.magicbricks.com/solutrean-gateway95")


def test_plot_project_page():
    d = mb_parse.parse_project_page(read("mb_project_plot.html"))
    assert round(d["lat"], 5) == 28.41698 and round(d["lng"], 5) == 76.90962
    assert d["rera_id"].startswith("GGM/607")
    assert "Outdoor Tennis Courts" in d["amenities"]


def test_flat_project_page():
    d = mb_parse.parse_project_page(read("mb_project_flat.html"))
    assert d["towers"] == 27 and d["units"] == 1356
    assert d["config_text"] == "2, 3, 4 BHK Multistorey Apartments"
    sizes = sorted((u["bhk"], u["sqft"]) for u in d["configs"]["units"])
    assert (4, 2740.0) in sizes and (2, 1296.0) in sizes
    assert d["configs"]["by_bhk"][3]["plan_images"][0].endswith(".jpg")


def test_card_units_and_type_codes():
    cards = {c["psmName"]: c for c in mb_parse.parse_list_page(read("mb_list.html"))}
    p = mb_parse.card_to_project(cards["Ganga Anantam"])
    assert p["card_units"][0] == {"bhk": 3, "sqft": 2050.0, "kind": "10002"}
    assert p["type_codes"] == ["10002"]
