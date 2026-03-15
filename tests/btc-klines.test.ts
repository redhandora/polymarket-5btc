import { describe, it, expect } from 'vitest';
import { interpolateBtcPrice, type BtcKline } from '../src/market-data/polymarket-history.js';

const klines: BtcKline[] = [
  { openTime: 0, open: 40000, close: 40060 },
  { openTime: 60000, open: 40060, close: 40120 },
  { openTime: 120000, open: 40120, close: 40180 },
  { openTime: 180000, open: 40180, close: 40240 },
  { openTime: 240000, open: 40240, close: 40300 },
];

describe('interpolateBtcPrice', () => {
  it('sec 0 returns first kline open', () => {
    expect(interpolateBtcPrice(klines, 0)).toBe(40000);
  });

  it('sec 35 interpolates within first kline', () => {
    // minute 0, frac = 35/60
    const expected = 40000 + (40060 - 40000) * (35 / 60);
    expect(interpolateBtcPrice(klines, 35)).toBeCloseTo(expected, 6);
  });

  it('sec 60 returns second kline open', () => {
    // minuteIdx = 1, secIntoMinute = 0, frac = 0
    expect(interpolateBtcPrice(klines, 60)).toBe(40060);
  });

  it('sec 299 clamps to last kline', () => {
    // minuteIdx = min(floor(299/60)=4, 4) = 4, secIntoMinute = 299-240=59, frac = 59/60
    const expected = 40240 + (40300 - 40240) * (59 / 60);
    expect(interpolateBtcPrice(klines, 299)).toBeCloseTo(expected, 6);
  });

  it('throws on empty klines', () => {
    expect(() => interpolateBtcPrice([], 35)).toThrow('empty klines');
  });
});
