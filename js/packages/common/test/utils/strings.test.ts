import { toUTF8Array, fromUTF8Array } from '../../src/utils/strings';

describe('UTF-8 encoding utilities', () => {
  describe('toUTF8Array / fromUTF8Array round-trips', () => {
    it('handles ASCII', () => {
      const str = 'Hello, World!';
      expect(fromUTF8Array(toUTF8Array(str))).toBe(str);
    });

    it('handles empty string', () => {
      expect(fromUTF8Array(toUTF8Array(''))).toBe('');
    });

    it('handles 2-byte UTF-8 characters', () => {
      const str = '\u00e9\u00f1'; // é ñ
      expect(fromUTF8Array(toUTF8Array(str))).toBe(str);
    });

    it('handles 3-byte UTF-8 characters', () => {
      const str = '\u4e16\u754c'; // 世界
      expect(fromUTF8Array(toUTF8Array(str))).toBe(str);
    });

    it('handles 4-byte UTF-8 characters (surrogate pairs)', () => {
      const str = '\uD83D\uDE00'; // 😀
      expect(fromUTF8Array(toUTF8Array(str))).toBe(str);
    });
  });

  describe('toUTF8Array', () => {
    it('produces standard UTF-8 bytes for ASCII', () => {
      expect(toUTF8Array('A')).toEqual([0x41]);
    });

    it('produces 2 bytes for codepoints 0x80-0x7FF', () => {
      const bytes = toUTF8Array('\u00e9');
      expect(bytes.length).toBe(2);
      expect(bytes[0]).toBe(0xc3);
      expect(bytes[1]).toBe(0xa9);
    });
  });
});
