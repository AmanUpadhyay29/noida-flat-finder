# Flat Finder

Every housing society in a city on one night map. Set the smallest bedroom you can live with, size, BHK, amenities and budget, and watch the societies that fit light up. Every number links to where it came from.

Gurugram is first: about 2,700 projects from Magicbricks, building outlines from OpenStreetMap, and a set of societies verified by reading builder brochures and HRERA plans.

## What the colours mean

- **Bright**: matches your search.
- **Amber**: likely. The rooms we have read pass, but not every bedroom has been read yet.
- **Faint outline**: not checked yet. We have no room sizes for it, so it is neither a pass nor a fail.
- **Dark**: does not match.

Building shapes come from OpenStreetMap where they are mapped. Where they are not, towers are drawn from the listed tower count and say "approximate shape" on the card. Shapes are visual only; data numbers are never estimated.

## Search from a terminal

```bash
npx github:kairothq/flat-finder --bhk 3,4 --min-bedroom "11'3x12'3" --min-sqft 1620 --amenity squash --likely
```

## Use it with Claude Code

`skills/flat-finder/SKILL.md` is a Claude Code skill. Copy it into `~/.claude/skills/flat-finder/` and ask Claude to "add Bangalore to flat finder", "verify Ireo Skyon", or "find me a 3 BHK with every bedroom at least 11 by 12 feet". It follows the same rules as this repo: primary sources first, never estimate, every number keeps its page.

## Run it

```bash
# data
cd pipeline
python3 mb_crawl.py list gurgaon && python3 mb_crawl.py projects gurgaon   # polite, cached, resumable
python3 osm_fetch.py gurgaon
python3 build_city.py gurgaon                                               # -> web/public/data/

# site
cd ../web && npm install && npm run dev
```

Tests: `cd pipeline && uv run --with pytest pytest` and `cd web && npx vitest run --root .. cli web/src`.

Cities live in `data/cities.json`. Gurugram is built; Bengaluru and Mumbai are configured and need the pipeline run (see the skill, Job 2).

Press `/` to search for a society. The Streets button switches to a street map with road and sector names.

Useful links: `?city=gurgaon`, `?map=streets`, `?preset=divy` loads the example search, `?open=<society id>` opens one society, `?nointro` skips the globe fly-in.

## Add verified research

Verified rows live in `data/verified/<city>.json`. Each unit type lists its bedrooms exactly as printed (`12'10"x16'4"` or millimetres `3350x3750`) with the source URL and page. Open a pull request, or use "Research this society" on any card to request one.

## Sources

Magicbricks project pages (listing facts), OpenStreetMap contributors (outlines, ODbL), Esri World Imagery (basemap), OpenFreeMap (roads and city buildings), HRERA Gurugram and builder brochures (verified rows).
