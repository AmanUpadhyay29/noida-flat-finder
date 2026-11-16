import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, feetLabel, matchSociety, roomPasses } from './filters.js';

const ROOM = { a: 11.25, b: 12.25 }; // 11'3" x 12'3"
const soc = (over = {}) => ({ kind: 'apartment', status: 'Ready To Move', amenities: [], amen_facts: {}, unit_types: [], ...over });
const crit = (over = {}) => ({ ...DEFAULT_CRITERIA, ...over });

describe('rooms', () => {
  it('11\'7" x 16\'0" passes, orientation-free', () => {
    expect(roomPasses([11.583, 16], ROOM)).toBe(true);
    expect(roomPasses([11.583, 16], { a: 12.25, b: 11.25 })).toBe(true);
  });
  it('10\'0" x 14\'0" fails even though the area is larger', () => {
    expect(roomPasses([10, 14], ROOM)).toBe(false);
  });
});

describe('matchSociety', () => {
  const unit = (bedrooms, complete, bhk = 3) => ({ bhk, super_sqft: 2000, bedrooms, rooms_complete: complete });

  it('no room data gives "unknown", never pass or fail', () => {
    const s = soc({ unit_types: [{ bhk: 3, size_sqft: 2000, bedrooms: [], rooms_complete: false }] });
    expect(matchSociety(s, crit({ room: ROOM }))).toBe('unknown');
  });
  it('incomplete rooms that pass give "likely"', () => {
    expect(matchSociety(soc({ unit_types: [unit([[12, 13]], false)] }), crit({ room: ROOM }))).toBe('likely');
  });
  it('complete rooms that pass give "match"', () => {
    expect(matchSociety(soc({ unit_types: [unit([[11.25, 12.25], [12, 14], [13, 15]], true)] }), crit({ room: ROOM }))).toBe('match');
  });
  it('one failing room fails the unit; another unit can still pass', () => {
    const s = soc({ unit_types: [unit([[11, 13]], true), unit([[12, 13], [12, 14], [13, 15], [14, 16]], true, 4)] });
    expect(matchSociety(s, crit({ room: ROOM, bhk: [3] }))).toBe('no');
    expect(matchSociety(s, crit({ room: ROOM }))).toBe('match');
  });
  it('a society with no unit data is "unknown" under a BHK filter', () => {
    expect(matchSociety(soc(), crit({ bhk: [3] }))).toBe('unknown');
  });
  it('verified amenity facts beat the portal list', () => {
    const s = soc({ amenities: ['Swimming Pool'], amen_facts: { squash: { value: 'yes' } } });
    expect(matchSociety(s, crit({ amenities: ['squash', 'pool'] }))).toBe('match');
    expect(matchSociety(soc({ amenities: ['Gymnasium'] }), crit({ amenities: ['squash'] }))).toBe('no');
  });
  it('plots are hidden by the default apartment filter', () => {
    expect(matchSociety(soc({ kind: 'plot' }), crit())).toBe('no');
  });
  it('minimum size uses super area, then portal size', () => {
    const s = soc({ unit_types: [{ bhk: 3, size_sqft: 1500, bedrooms: [] }] });
    expect(matchSociety(s, crit({ minSqft: 1620 }))).toBe('no');
    expect(matchSociety(s, crit({ minSqft: 1400 }))).toBe('match');
  });
});

it('feetLabel', () => {
  expect(feetLabel(11.25)).toBe('11\'3"');
  expect(feetLabel(12.833)).toBe('12\'10"');
});
