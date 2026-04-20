import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { publicKey, uint64, uint128, rustString } from '../../src/utils/layout';

describe('layout utilities', () => {
  describe('publicKey', () => {
    it('round-trips a PublicKey through encode/decode', () => {
      const layout = publicKey('key') as any;
      const original = new PublicKey(
        'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
      );
      const buffer = Buffer.alloc(32);
      layout.encode(original, buffer, 0);
      const decoded = layout.decode(buffer, 0);
      expect(decoded.toBase58()).toBe(original.toBase58());
    });

    it('encodes the system program ID correctly', () => {
      const layout = publicKey('key') as any;
      const systemProgram = new PublicKey('11111111111111111111111111111111');
      const buffer = Buffer.alloc(32);
      layout.encode(systemProgram, buffer, 0);
      const decoded = layout.decode(buffer, 0);
      expect(decoded.toBase58()).toBe(systemProgram.toBase58());
    });
  });

  describe('uint64', () => {
    it('round-trips zero', () => {
      const layout = uint64('amount') as any;
      const buffer = Buffer.alloc(8);
      const val = new BN(0);
      layout.encode(val, buffer, 0);
      const decoded: BN = layout.decode(buffer, 0);
      expect(decoded.eq(val)).toBe(true);
    });

    it('round-trips a small value', () => {
      const layout = uint64('amount') as any;
      const buffer = Buffer.alloc(8);
      const val = new BN(1_000_000);
      layout.encode(val, buffer, 0);
      const decoded: BN = layout.decode(buffer, 0);
      expect(decoded.eq(val)).toBe(true);
    });

    it('round-trips u64 max', () => {
      const layout = uint64('amount') as any;
      const buffer = Buffer.alloc(8);
      const val = new BN('ffffffffffffffff', 16);
      layout.encode(val, buffer, 0);
      const decoded: BN = layout.decode(buffer, 0);
      expect(decoded.eq(val)).toBe(true);
    });

    it('stores as little-endian', () => {
      const layout = uint64('amount') as any;
      const buffer = Buffer.alloc(8);
      layout.encode(new BN(1), buffer, 0);
      expect(buffer[0]).toBe(1);
      expect(buffer[7]).toBe(0);
    });
  });

  describe('uint128', () => {
    it('round-trips zero', () => {
      const layout = uint128('val') as any;
      const buffer = Buffer.alloc(16);
      const val = new BN(0);
      layout.encode(val, buffer, 0);
      const decoded: BN = layout.decode(buffer, 0);
      expect(decoded.eq(val)).toBe(true);
    });

    it('round-trips a large value', () => {
      const layout = uint128('val') as any;
      const buffer = Buffer.alloc(16);
      const val = new BN('ffffffffffffffffffffffffffffffff', 16);
      layout.encode(val, buffer, 0);
      const decoded: BN = layout.decode(buffer, 0);
      expect(decoded.eq(val)).toBe(true);
    });

    it('round-trips a value that exceeds u64 range', () => {
      const layout = uint128('val') as any;
      const buffer = Buffer.alloc(16);
      const val = new BN('10000000000000000', 16); // 2^64
      layout.encode(val, buffer, 0);
      const decoded: BN = layout.decode(buffer, 0);
      expect(decoded.eq(val)).toBe(true);
    });
  });

  describe('rustString', () => {
    it('round-trips an ASCII string', () => {
      const layout = rustString('name') as any;
      const str = 'hello world';
      const buffer = Buffer.alloc(256);
      layout.encode(str, buffer, 0);
      const decoded = layout.decode(buffer, 0);
      expect(decoded).toBe(str);
    });

    it('round-trips an empty string', () => {
      const layout = rustString('name') as any;
      const str = '';
      const buffer = Buffer.alloc(256);
      layout.encode(str, buffer, 0);
      const decoded = layout.decode(buffer, 0);
      expect(decoded).toBe(str);
    });
  });
});
