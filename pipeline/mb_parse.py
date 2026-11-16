"""Parse Magicbricks list and project pages from their embedded JSON state."""
import json
import re

_DEC = json.JSONDecoder()


def _json_after(html, marker):
    i = html.find(marker)
    if i < 0:
        return None
    j = html.find("=", i) + 1
    obj, _ = _DEC.raw_decode(html[j:].lstrip())
    return obj


def parse_total(html):
    m = re.search(r'"totalCount":(\d+)', html)
    return int(m.group(1)) if m else None


def parse_list_page(html):
    """Return the project cards on a list page (dicts with psmName, pdpUrl, ...)."""
    cards = []
    for m in re.finditer(r'"psmName":', html):
        # walk back to the start of the enclosing object
        j = html.rfind("{", 0, m.start())
        while j > 0:
            try:
                obj, _ = _DEC.raw_decode(html[j:])
                if "psmName" in obj and "pdpUrl" in obj:
                    cards.append(obj)
                    break
            except ValueError:
                pass
            j = html.rfind("{", 0, j)
    seen, out = set(), []
    for c in cards:
        if c["psmid"] not in seen:
            seen.add(c["psmid"])
            out.append(c)
    return out


def _num(v):
    try:
        f = float(v)
        return f if f == f and f != 0 else None
    except (TypeError, ValueError):
        return None


def card_to_project(c):
    return {
        "mb_id": c.get("psmid"),
        "name": (c.get("psmName") or "").strip(),
        "developer": c.get("devName"),
        "locality": c.get("lmtDName"),
        "pincode": c.get("pincode"),
        "status": c.get("showReadyToMove"),
        "possession": c.get("prjPossYear"),
        "units": c.get("totalUnits") or None,
        "towers": c.get("noTower") or None,
        "acres": c.get("projArea") if c.get("projAreaUnitDesc") == "Acre" else None,
        "price_min": _num(c.get("seoSMinPrice")),
        "price_max": _num(c.get("seoSMaxPrice")),
        "prop_types": c.get("psmcndproptypes"),
        "brochure_url": c.get("sblink"),
        "card_units": parse_unit_info(c.get("unitInfo") or ""),
        "type_codes": [t.strip() for t in str(c.get("ty") or "").split(",") if t.strip()],
        "url": "https://www.magicbricks.com/" + c["pdpUrl"],
    }


def parse_project_page(html):
    """Return details from a project page: coordinates, RERA, amenities, towers, unit configs."""
    state = _json_after(html, "window.SERVER_PRELOADED_STATE_") or {}
    pdd = state.get("projectDetailData") or {}
    mob = pdd.get("prjMobileBean") or {}
    info = mob.get("infoBean") or {}
    det = mob.get("detailBean") or {}
    lat, lng = _num(info.get("psmLatitude")), _num(info.get("psmLongitude"))
    amen = [a.get("amenityName") for a in (mob.get("amenitiesList") or []) if a.get("amenityName")]
    return {
        "lat": lat,
        "lng": lng,
        "rera_id": det.get("reraId"),
        "towers": _num(det.get("towers")),
        "units": _num(det.get("units")),
        "status": det.get("status"),
        "amenities": amen,
        "config_text": det.get("prjConfig"),
        "configs": parse_configs(state),
    }


def parse_unit_info(raw):
    """'2 , 10002 , 1484  Sq-ft | ...' -> [{bhk, sqft, kind}]; entries without a size are dropped."""
    units = []
    for part in raw.split("|"):
        bits = [b.strip() for b in part.split(",")]
        if len(bits) != 3:
            continue
        m = re.match(r"([\d.]+)\s*Sq-ft", bits[2])
        if not m:
            continue
        units.append({
            "bhk": int(bits[0]) if bits[0].isdigit() else None,
            "sqft": float(m.group(1)),
            "kind": bits[1],
        })
    return units


def parse_configs(state):
    """Unit types from mUnitInfo plus per-BHK prices and plan image links."""
    pdd = state.get("projectDetailData") or {}
    units = parse_unit_info(pdd.get("mUnitInfo") or "")
    pricing = (state.get("projectPageSeoStaticData") or {}).get("pdpUnitPricing") or {}
    plans = {}
    for key, rows in pricing.items():
        mm = re.match(r"(\d+) BHK", key)
        if not mm or not isinstance(rows, list):
            continue
        b = int(mm.group(1))
        plans[b] = {
            "price_min": min((r.get("minPriceD") or 0) for r in rows) or None,
            "price_max": max((r.get("maxPriceD") or 0) for r in rows) or None,
            "plan_images": sorted({"https://img.staticmb.com/mbimages/project/Photo_h0_w0/" + r["unitFlrPlanImg"]
                                   for r in rows if r.get("unitFlrPlanImg")}),
        }
    return {"units": units, "by_bhk": plans}
