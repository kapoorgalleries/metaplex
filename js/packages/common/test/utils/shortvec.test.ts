import { encodeLength, decodeLength } from '../../src/utils/shortvec';

describe('shortvec encoding', () => {
  describe('encodeLength / decodeLength round-trips', () => {
    const cases = [0, 1, 127, 128, 255, 256, 16383, 16384, 65535];

    it.each(cases)('round-trips %i', (len: number) => {
      const bytes: number[] = [];
      encodeLength(bytes, len);
      const decoded = decodeLength([...bytes]);
      expect(decoded).toBe(len);
    });
  });

  describe('encodeLength', () => {
    it('encodes 0 as a single byte', () => {
      const bytes: number[] = [];
      encodeLength(bytes, 0);
      expect(bytes).toEqual([0]);
    });

    it('encodes 127 as a single byte', () => {
      const bytes: number[] = [];
      encodeLength(bytes, 127);
      expect(bytes).toEqual([127]);
    });

    it('encodes 128 as two bytes (varint)', () => {
      const bytes: number[] = [];
      encodeLength(bytes, 128);
      expect(bytes.length).toBe(2);
      expect(bytes[0]).toBe(0x80);
      expect(bytes[1]).toBe(0x01);
    });
  });

  describe('decodeLength', () => {
    it('mutates the input array (shifts bytes)', () => {
      const bytes = [0x80, 0x01, 0xff];
      decodeLength(bytes);
      expect(bytes).toEqual([0xff]);
    });
  });
});
