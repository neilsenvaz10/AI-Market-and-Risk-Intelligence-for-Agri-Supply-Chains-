import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import directory from '../src/data/location-index.json';
import { INDIAN_STATES } from '../src/constants/profile';
import { validateProfile, EMPTY_PROFILE } from '../src/utils/profileValidation';
import { validateFarmerPayload } from '../../backend/src/validators/farmer.validator.js';

let service;
beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  service = await import('../src/services/locationService');
});
const reply = (data) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

describe('bundled location directory', () => {
  it('covers every supported state and keeps every district file under its correct parent', () => {
    expect(directory.map((state) => state.name).sort()).toEqual([...INDIAN_STATES].sort());
    const codes = new Set();
    let options = 0;
    for (const state of directory) {
      expect(state.districts.length).toBeGreaterThan(0);
      for (const district of state.districts) {
        expect(codes.has(district.code)).toBe(false);
        codes.add(district.code);
        const data = JSON.parse(fs.readFileSync(new URL(`../public/locations/${district.code}.json`, import.meta.url)));
        expect(data.stateCode).toBe(state.code);
        expect(data.districtCode).toBe(district.code);
        expect(data.names.length).toBe(district.placeCount);
        expect(new Set(data.names.map((name) => name.toLowerCase())).size).toBe(data.names.length);
        options += data.names.length;
      }
    }
    expect(codes.size).toBe(784);
    expect(options).toBe(620164);
  });

  it('maps Nashik only under Maharashtra, with Lasalgaon among its places', () => {
    expect(service.getDistrict('Maharashtra', 'Nashik').code).toBe('487');
    expect(service.getDistrict('Goa', 'Nashik')).toBeUndefined();
    const data = JSON.parse(fs.readFileSync(new URL('../public/locations/487.json', import.meta.url)));
    expect(data.names).toContain('Lasalgaon');
  });

  it('accepts legitimate directory punctuation in both profile validators', () => {
    for (const village of ['Rampur/Habibpur', 'Rampur (A&B)', 'Rampur@Habibpur', 'Rampur [East]']) {
      const profile = { ...EMPTY_PROFILE, fullName: 'Test Farmer', state: 'Maharashtra', district: 'Nashik',
        village, primaryCrop: 'Onion', cropQuantity: 25 };
      expect(validateProfile(profile)).toEqual({});
      expect(validateFarmerPayload(profile).errors).toBeNull();
    }
  });
});

describe('location loading and validation', () => {
  it('loads only a matched district, caches successes, and never sends farmer credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ stateCode: '27', districtCode: '487', names: ['Lasalgaon'] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await service.loadPlaces('Goa', 'Nashik')).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await service.loadPlaces('Maharashtra', 'Nashik')).toEqual(['Lasalgaon']);
    expect(await service.loadPlaces('Maharashtra', 'Nashik')).toEqual(['Lasalgaon']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/locations/487.json');
    expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
  });

  it('rejects a district file with the wrong parent and permits retry after a failure', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ stateCode: '30', districtCode: '487', names: ['Wrong'] }))
      .mockResolvedValueOnce(reply({ stateCode: '27', districtCode: '487', names: ['Lasalgaon'] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(service.loadPlaces('Maharashtra', 'Nashik')).rejects.toThrow('Invalid location directory');
    expect(await service.loadPlaces('Maharashtra', 'Nashik')).toEqual(['Lasalgaon']);
  });

  it('rejects mismatched district/village entries and normalizes an accepted village spelling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ stateCode: '27', districtCode: '487', names: ['Lasalgaon'] })));
    expect((await service.validateLocation({ state: 'Goa', district: 'Nashik', village: '' })).errors).toHaveProperty('district');
    expect((await service.validateLocation({ state: 'Maharashtra', district: 'Nashik', village: 'Panaji' })).errors).toHaveProperty('village');
    expect(await service.validateLocation({ state: 'Maharashtra', district: 'Nashik', village: ' lasalgaon ' })).toEqual({ errors: {}, village: 'Lasalgaon' });
  });

  it('retains an unchanged legacy address and allows the optional village to be empty', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const legacy = { state: 'Maharashtra', district: 'Aurangabad', village: 'जुने गाव' };
    expect((await service.validateLocation(legacy, legacy)).errors).toEqual({});
    expect(await service.validateLocation({ state: 'Maharashtra', district: 'Nashik', village: '' })).toEqual({ errors: {}, village: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
