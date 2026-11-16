"""Merge Magicbricks projects, OSM shapes and verified research into the web data files.

usage: python build_city.py <city>  -> web/public/data/<city>.json, <city>-shapes.geojson, cities.json
"""
import json
import math
import pathlib
import re
import sys
from collections import defaultdict

import geo
import verified

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "out"
WEB = ROOT.parent / "web" / "public" / "data"
GENERIC = {"the", "of", "at", "in", "sector", "gurgaon", "gurugram", "residency", "residences", "homes",
           "apartments", "apartment", "towers", "tower", "heights", "city", "phase", "park", "estate",
           "floors", "society", "cghs", "group", "housing", "and", "by", "new", "greens", "green", "plaza"}
TOWER_H = 55.0  # visual default height (m) for generated apartment towers; shapes are not data


def tokens(name):
    return {t for t in re.findall(r"[a-z0-9]+", (name or "").lower()) if t not in GENERIC and len(t) > 2}


UNIT_KIND = {"10002": "apartment", "10021": "apartment", "10003": "builder floor", "10000": "plot", "10017": "villa",
             "10007": "commercial", "10008": "commercial", "10009": "commercial", "10022": "apartment"}


def kind_of(p):
    t = (p.get("config_text") or "").lower()
    if not t:
        codes = [u["kind"] for u in (p.get("configs") or {}).get("units", []) or p.get("card_units") or []] + (p.get("type_codes") or [])
        kinds = [UNIT_KIND.get(c, "other") for c in codes]
        if kinds:
            for k in ("apartment", "builder floor", "villa", "plot", "commercial"):
                if k in kinds:
                    return k
        return infer_kind_from_name(p)
    if "apartment" in t or "penthouse" in t or "studio" in t or "flat" in t:
        return "apartment"
    if "floor" in t:
        return "builder floor"
    if "villa" in t or "house" in t:
        return "villa"
    if "plot" in t or "land" in t:
        return "plot"
    return "apartment" if re.search(r"\bbhk\b", t) else "other"


def infer_kind_from_name(p):
    """Last resort when the portal gives no type. Marked as inferred on the card."""
    n = " " + (p.get("name") or "").lower() + " "
    if re.search(r"\b(plots?|land)\b", n):
        return "plot~"
    if re.search(r"\b(villas?|kothi|bungalows?)\b", n):
        return "villa~"
    if re.search(r"\bfloors?\b", n):
        return "builder floor~"
    if re.search(r"\b(business|centre|center|mall|plaza|office|offices|commercial|corporate|hotel|hub|arcade|market|retail|square|district|spaces?)\b", n) and not p.get("units"):
        return "commercial~"
    if re.search(r"\b(business|corporate|mall|office|commercial|district)\b", n):
        return "commercial~"
    return "apartment~"


class Grid:
    """Bucket features by 0.01 degree cells for fast nearby lookups."""

    def __init__(self, items, key):
        self.cells = defaultdict(list)
        for it in items:
            x, y = key(it)
            self.cells[(int(x * 100), int(y * 100))].append(it)

    def near(self, pt, r=1):
        cx, cy = int(pt[0] * 100), int(pt[1] * 100)
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                yield from self.cells.get((cx + dx, cy + dy), [])


def match_area(project, area_grid):
    """OSM named area that contains the project point, or a name-matching one within 300 m."""
    pt = (project["lng"], project["lat"])
    pt_tokens = tokens(project["name"])
    best, best_score = None, 0
    for a in area_grid.near(pt):
        ring = a["geometry"]["coordinates"][0]
        inside = geo.point_in_ring(pt, ring)
        shared = len(pt_tokens & tokens(a["properties"]["name"]))
        if not inside and not shared:
            continue
        d = 0 if inside else geo.dist_m(pt, geo.centroid(ring))
        if d > 300:
            continue
        # skip neighbourhood-sized areas (whole sectors, DLF phases) unless the project itself is that big
        size = geo.area_m2(ring)
        limit = max(250_000, 3 * (project.get("acres") or 0) * 4047)
        if size > limit:
            continue
        score = shared * 10 + (5 if inside else 0) - d / 100
        if score > best_score:
            best, best_score = a, score
    return best


def dedupe(projects):
    """Merge listings with the same name tokens less than 400 m apart (phases, duplicates)."""
    kept = []
    for p in projects:
        for q in kept:
            if tokens(p["name"]) == tokens(q["name"]) and tokens(p["name"]) and \
                    geo.dist_m((p["lng"], p["lat"]), (q["lng"], q["lat"])) < 400:
                q.setdefault("merged", []).append(p["url"])
                break
        else:
            kept.append(p)
    return kept


def portal_units(p):
    units = []
    for u in (p.get("configs") or {}).get("units", []) or p.get("card_units") or []:
        units.append({"label": f"{u['bhk']} BHK {int(u['sqft']):,} sq ft" if u["bhk"] else f"{int(u['sqft']):,} sq ft",
                      "bhk": u["bhk"], "size_sqft": u["sqft"], "bedrooms": [], "rooms_complete": False,
                      "confidence": "portal", "source": p["url"], "page": None})
    return units


def norm(name):
    return " ".join(re.findall(r"[a-z0-9]+", (name or "").lower()))


def match_verified(v, projects, taken=()):
    """Portal project for a verified society: a match name must appear whole in the portal name, same sector if known."""
    best = None
    for p in projects:
        if p["mb_id"] in taken:
            continue
        if v.get("sector") and not re.search(rf"\b{v['sector']}\b", p.get("locality") or ""):
            continue
        n = f" {norm(p['name'])} "
        if any(f" {norm(m)} " in n for m in v["match"]):
            if best is None or len(p["name"]) < len(best["name"]):
                best = p
    return best


def events_for(s):
    ev = []
    sid = s["id"]
    src = s.get("url")
    ev.append({"sid": sid, "step": "Located on map", "finding": f"{s['locality'] or 'Gurgaon'} · {s['lat']:.4f}, {s['lng']:.4f}", "url": src})
    bits = [f"{int(s['towers'])} towers" if s.get("towers") else None, f"{int(s['units']):,} units" if s.get("units") else None,
            f"{s['acres']} acres" if s.get("acres") else None]
    if any(bits):
        ev.append({"sid": sid, "step": "Project page read", "finding": " · ".join(b for b in bits if b), "url": src})
    if s.get("rera_id"):
        ev.append({"sid": sid, "step": "RERA registration", "finding": s["rera_id"][:60], "url": src})
    if s["amenities"]:
        ev.append({"sid": sid, "step": f"{len(s['amenities'])} amenities listed", "finding": ", ".join(s["amenities"][:4]), "url": src})
    for k, f in s.get("amen_facts", {}).items():
        ev.append({"sid": sid, "step": f"Checked {k} court", "finding": f"{f['value']} · p.{f.get('page')}", "url": f["source"], "verified": True})
    for u in s["unit_types"]:
        if u["bedrooms"]:
            printed = ", ".join(u.get("bedrooms_printed") or [])
            ev.append({"sid": sid, "step": f"Reading plan p.{u['page']}", "finding": f"{u['label']} · bedrooms {printed}",
                       "url": u["source"], "verified": u["confidence"] == "primary", "unit": u["label"]})
        elif u.get("size_sqft"):
            ev.append({"sid": sid, "step": "Unit type listed", "finding": u["label"], "url": u["source"]})
    return ev


def shapes_for(s, area, bld_grid, sid_seed):
    feats = []
    is_tall = s["kind"] == "apartment"
    if area:
        ring = area["geometry"]["coordinates"][0]
        feats.append({"type": "Feature", "properties": {"sid": s["id"], "role": "site"}, "geometry": {"type": "Polygon", "coordinates": [ring]}})
        x0, y0, x1, y1 = geo.bbox(ring)
        inside = [b for b in bld_grid.near(geo.centroid(ring), r=2)
                  if x0 <= b["_c"][0] <= x1 and y0 <= b["_c"][1] <= y1 and geo.point_in_ring(b["_c"], ring)]
        if inside:
            for b in inside:
                h = b["properties"]["h"] or (TOWER_H if is_tall else 9.0)
                feats.append({"type": "Feature", "properties": {"sid": s["id"], "role": "bld", "h": h, "shape": "osm"}, "geometry": b["geometry"]})
            return feats, "osm"
        site, shape = ring, "osm-site"
    else:
        r = math.sqrt((s.get("acres") or 3) * 4047 / math.pi) if (s.get("acres") or 0) < 200 else 120
        site, shape = geo.circle((s["lng"], s["lat"]), max(40, min(r, 400))), "generated"
        feats.append({"type": "Feature", "properties": {"sid": s["id"], "role": "site"}, "geometry": {"type": "Polygon", "coordinates": [site]}})
    if s["kind"] == "plot":
        return feats, shape
    n = int(s.get("towers") or 0) or (max(2, min(12, round((s.get("units") or 300) / 120))) if is_tall else 8)
    w, d = (24, 18) if is_tall else (12, 10)
    for t in geo.generate_towers(site, n, seed=sid_seed, w_m=w, d_m=d):
        feats.append({"type": "Feature", "properties": {"sid": s["id"], "role": "bld", "h": TOWER_H if is_tall else 10.0, "shape": "generated"},
                      "geometry": {"type": "Polygon", "coordinates": [t]}})
    return feats, shape


def main(city="gurgaon"):
    cfg = json.loads((ROOT.parent / "data" / "cities.json").read_text())[city]
    out = OUT / city
    raw = json.loads((out / "mb_projects.json").read_text())
    located = [p for p in raw if p.get("lat") and p.get("lng") and 28.2 < p["lat"] < 28.7 and 76.7 < p["lng"] < 77.3]
    not_located = len(raw) - len(located)
    projects = dedupe(located)
    areas = json.loads((out / "osm_areas.geojson").read_text())["features"]
    area_grid = Grid(areas, lambda a: geo.centroid(a["geometry"]["coordinates"][0]))
    blds = json.loads((out / "osm_buildings.geojson").read_text())["features"]
    for b in blds:
        b["_c"] = geo.centroid(b["geometry"]["coordinates"][0])
    bld_grid = Grid(blds, lambda b: b["_c"])

    vfile = verified.ROOT / "data" / "verified" / f"{city}.json"
    ver = verified.load_verified(vfile) if vfile.exists() else []
    societies, shapes, events, used_areas = [], [], [], set()
    for i, p in enumerate(projects):
        s = {"id": f"s{p['mb_id']}", "name": p["name"], "developer": p.get("developer"), "locality": p.get("locality"),
             "lat": round(p["lat"], 6), "lng": round(p["lng"], 6), "status": p.get("status"), "possession": p.get("possession"),
             "rera_id": p.get("rera_id"), "units": p.get("units"), "towers": p.get("towers"), "acres": p.get("acres"),
             "price_min": p.get("price_min"), "price_max": p.get("price_max"), "kind": kind_of(p).rstrip("~"),
             "kind_inferred": kind_of(p).endswith("~"),
             "config_text": p.get("config_text"), "amenities": p.get("amenities") or [], "amen_facts": {},
             "unit_types": portal_units(p), "url": p["url"], "brochure_url": p.get("brochure_url"),
             "plan_links": {b: v["plan_images"] for b, v in ((p.get("configs") or {}).get("by_bhk") or {}).items() if v["plan_images"]},
             "verified": False, "note": None}
        if s["towers"] and s["towers"] > 60:  # portal typo (e.g. 1500 towers): not plausible, drop it
            s["towers"] = None
        p["_s"] = s
        societies.append(s)

    taken = set()
    for v in ver:
        p = match_verified(v, projects, taken)
        if not p:
            print("verified society not found in portal data:", v["name"])
            continue
        taken.add(p["mb_id"])
        s = p["_s"]
        s["verified"] = bool(v["unit_types"])
        s["note"] = v["note"]
        s["amen_facts"] = v["amen_facts"]
        if v["unit_types"]:
            s["unit_types"] = v["unit_types"] + [u for u in s["unit_types"] if u["bhk"] not in {x["bhk"] for x in v["unit_types"]}]

    for i, s in enumerate(societies):
        area = match_area(s, area_grid)
        if area and area["properties"]["osm"] in used_areas:
            area = None  # another society already owns this boundary
        if area:
            used_areas.add(area["properties"]["osm"])
            s["osm_area"] = area["properties"]["osm"]
        f, shape = shapes_for(s, area, bld_grid, i)
        s["shape"] = shape
        shapes.extend(f)
        events.extend(events_for(s))

    WEB.mkdir(parents=True, exist_ok=True)
    doc = {"city": {"id": city, "name": cfg["name"], "center": cfg["center"], "zoom": cfg["zoom"]},
            "counts": {"listed": len(raw), "on_map": len(societies), "not_located": not_located,
                       "verified": sum(s["verified"] for s in societies)},
            "sources": ["Magicbricks project pages", "OpenStreetMap contributors", "HRERA Gurugram", "Builder brochures (verified rows)"],
            "societies": societies, "events": events}
    (WEB / f"{city}.json").write_text(json.dumps(doc, separators=(",", ":")))
    for f in shapes:
        f["geometry"]["coordinates"] = [[[round(x, 5), round(y, 5)] for x, y in r] for r in f["geometry"]["coordinates"]]
        if "h" in f["properties"]:
            f["properties"]["h"] = round(f["properties"]["h"])
    (WEB / f"{city}-shapes.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": shapes}, separators=(",", ":")))
    from collections import Counter
    built = sorted(p.stem for p in WEB.glob("*.json") if p.stem != "cities")
    all_cfg = json.loads((ROOT.parent / "data" / "cities.json").read_text())
    (WEB / "cities.json").write_text(json.dumps({c: {"name": all_cfg[c]["name"]} for c in built if c in all_cfg}))
    print(doc["counts"], Counter(s["shape"] for s in societies), Counter(s["kind"] for s in societies), "features", len(shapes))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "gurgaon")
