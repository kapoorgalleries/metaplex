import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  shortenAddress,
  chunks,
  toLamports,
  fromLamports,
  wadToLamports,
  tryParseKey,
  formatAmount,
  getTokenName,
  getTokenByName,
  isKnownMint,
  sleep,
} from '../../src/utils/utils';

describe('utility functions', () => {
  describe('shortenAddress', () => {
    it('shortens to 4+4 chars by default', () => {
      const addr = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
      expect(shortenAddress(addr)).toBe('meta...8x1s');
    });

    it('respects custom char count', () => {
      const addr = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
      expect(shortenAddress(addr, 6)).toBe('metaqb...518x1s');
    });
  });

  describe('chunks', () => {
    it('splits an array into equal chunks', () => {
      expect(chunks([1, 2, 3, 4, 5, 6], 2)).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ]);
    });

    it('handles a remainder chunk', () => {
      expect(chunks([1, 2, 3, 4, 5], 3)).toEqual([
        [1, 2, 3],
        [4, 5],
      ]);
    });

    it('handles empty array', () => {
      expect(chunks([], 5)).toEqual([]);
    });

    it('handles chunk size larger than array', () => {
      expect(chunks([1, 2], 10)).toEqual([[1, 2]]);
    });
  });

  describe('toLamports', () => {
    it('returns 0 for undefined input', () => {
      expect(toLamports(undefined)).toBe(0);
    });

    it('converts a number with no decimals', () => {
      expect(toLamports(5, { decimals: 0 } as any)).toBe(5);
    });

    it('converts a number with 9 decimals (SOL)', () => {
      expect(toLamports(1, { decimals: 9 } as any)).toBe(1_000_000_000);
    });

    it('floors the result', () => {
      expect(toLamports(1.5, { decimals: 2 } as any)).toBe(150);
    });
  });

  describe('fromLamports', () => {
    it('returns 0 for undefined input', () => {
      expect(fromLamports(undefined)).toBe(0);
    });

    it('converts lamports to SOL (9 decimals default)', () => {
      expect(fromLamports(1_000_000_000)).toBe(1);
    });

    it('uses explicit mint decimals', () => {
      expect(fromLamports(500, { decimals: 2 } as any)).toBe(5);
    });

    it('applies rate', () => {
      expect(fromLamports(1_000_000_000, undefined, 2.0)).toBe(2);
    });

    it('handles BN input', () => {
      expect(fromLamports(new BN(2_000_000_000))).toBe(2);
    });
  });

  describe('wadToLamports', () => {
    it('returns ZERO for undefined', () => {
      const result = wadToLamports(undefined);
      expect(result.eq(new BN(0))).toBe(true);
    });

    it('divides by WAD (10^18)', () => {
      const wad = new BN(10).pow(new BN(18));
      const result = wadToLamports(wad.muln(42));
      expect(result.eq(new BN(42))).toBe(true);
    });
  });

  describe('tryParseKey', () => {
    it('returns PublicKey for valid base58', () => {
      const key = tryParseKey('11111111111111111111111111111111');
      expect(key).toBeInstanceOf(PublicKey);
    });

    it('returns null for invalid string', () => {
      expect(tryParseKey('not-a-key!')).toBeNull();
    });
  });

  describe('formatAmount', () => {
    it('formats with default precision', () => {
      expect(formatAmount(1234.5678)).toBe('1.23k');
    });

    it('formats small numbers without suffix', () => {
      expect(formatAmount(42.123)).toBe('42.12');
    });

    it('does not abbreviate when abbr is false', () => {
      expect(formatAmount(1234.5678, 2, false)).toBe('1234.57');
    });
  });

  describe('getTokenName', () => {
    const map = new Map([['mintAddr1', { symbol: 'SOL' } as any]]);

    it('returns known symbol', () => {
      expect(getTokenName(map, 'mintAddr1')).toBe('SOL');
    });

    it('returns shortened address for unknown mint', () => {
      const unknownAddr = '11111111111111111111111111111111';
      expect(getTokenName(map, unknownAddr)).toBe('11111...');
    });

    it('returns N/A for undefined mint', () => {
      expect(getTokenName(map, undefined)).toBe('N/A');
    });

    it('returns full address when shorten=false', () => {
      const addr = '11111111111111111111111111111111';
      expect(getTokenName(map, addr, false)).toBe(addr);
    });
  });

  describe('getTokenByName', () => {
    const map = new Map([
      ['addr1', { symbol: 'USDC', name: 'USD Coin' } as any],
    ]);

    it('finds a token by symbol', () => {
      expect(getTokenByName(map, 'USDC')?.name).toBe('USD Coin');
    });

    it('returns null for unknown symbol', () => {
      expect(getTokenByName(map, 'UNKNOWN')).toBeNull();
    });
  });

  describe('isKnownMint', () => {
    const map = new Map([['addr1', {} as any]]);

    it('returns true for known mint', () => {
      expect(isKnownMint(map, 'addr1')).toBe(true);
    });

    it('returns false for unknown mint', () => {
      expect(isKnownMint(map, 'addr2')).toBe(false);
    });
  });

  describe('sleep', () => {
    it('resolves after the specified time', async () => {
      const start = Date.now();
      await sleep(50);
      expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    });
  });
});
