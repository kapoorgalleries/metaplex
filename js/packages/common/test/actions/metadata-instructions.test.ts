import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import BN from 'bn.js';
import '../../src/utils/borsh';
import {
  createMetadata,
  updateMetadata,
  createMasterEdition,
  signMetadata,
  updatePrimarySaleHappenedViaToken,
  mintPrintingTokens,
  getEdition,
  getMetadata,
  getReservationList,
  Data,
  Creator,
  METADATA_PREFIX,
  EDITION,
  RESERVATION,
} from '../../src/actions/metadata';
import { programIds } from '../../src/utils/ids';

const randomPubkey = () =>
  new PublicKey(Buffer.alloc(32).fill(Math.random() * 255));

const testData = () =>
  new Data({
    name: 'Test',
    symbol: 'TST',
    uri: 'https://example.com',
    sellerFeeBasisPoints: 500,
    creators: [
      new Creator({ address: randomPubkey(), verified: true, share: 100 }),
    ],
  });

describe('Metadata instruction builders', () => {
  describe('createMetadata', () => {
    it('pushes one instruction with 7 account keys', async () => {
      const instructions: any[] = [];
      await createMetadata(
        testData(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
        randomPubkey(),
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(7);
    });

    it('instruction data starts with byte 0 (CreateMetadata)', async () => {
      const instructions: any[] = [];
      await createMetadata(
        testData(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
        randomPubkey(),
      );

      expect(instructions[0].data[0]).toBe(0);
    });

    it('returns the metadata account PDA', async () => {
      const instructions: any[] = [];
      const mintKey = randomPubkey();
      const result = await createMetadata(
        testData(),
        randomPubkey(),
        mintKey,
        randomPubkey(),
        instructions,
        randomPubkey(),
      );

      expect(result).toBeInstanceOf(PublicKey);
      const expected = await getMetadata(mintKey);
      expect(result.toBase58()).toBe(expected.toBase58());
    });
  });

  describe('updateMetadata', () => {
    it('pushes one instruction with 2 account keys', async () => {
      const instructions: any[] = [];
      await updateMetadata(
        testData(),
        undefined,
        null,
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(2);
    });

    it('instruction data starts with byte 1 (UpdateMetadata)', async () => {
      const instructions: any[] = [];
      await updateMetadata(
        undefined,
        undefined,
        null,
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions[0].data[0]).toBe(1);
    });

    it('returns the metadata account', async () => {
      const instructions: any[] = [];
      const mintKey = randomPubkey();
      const result = await updateMetadata(
        testData(),
        undefined,
        null,
        mintKey,
        randomPubkey(),
        instructions,
      );

      expect(result).toBeInstanceOf(PublicKey);
    });
  });

  describe('createMasterEdition', () => {
    it('pushes one instruction with at least 12 account keys', async () => {
      const instructions: any[] = [];
      await createMasterEdition(
        new BN(100),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
        randomPubkey(),
        randomPubkey(),
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBeGreaterThanOrEqual(12);
    });

    it('instruction data starts with byte 2 (CreateMasterEdition)', async () => {
      const instructions: any[] = [];
      await createMasterEdition(
        new BN(10),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
        randomPubkey(),
        randomPubkey(),
      );

      expect(instructions[0].data[0]).toBe(2);
    });

    it('adds optional oneTimePrintingAuthorizationMintAuthority key', async () => {
      const instructions: any[] = [];
      const extraAuth = randomPubkey();
      await createMasterEdition(
        new BN(10),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
        randomPubkey(),
        randomPubkey(),
        extraAuth,
      );

      expect(instructions[0].keys.length).toBe(13);
      expect(instructions[0].keys[12].pubkey.toBase58()).toBe(
        extraAuth.toBase58(),
      );
    });
  });

  describe('signMetadata', () => {
    it('pushes one instruction with raw byte 7', async () => {
      const instructions: any[] = [];
      await signMetadata(randomPubkey(), randomPubkey(), instructions);

      expect(instructions.length).toBe(1);
      expect(instructions[0].data.length).toBe(1);
      expect(instructions[0].data[0]).toBe(7);
      expect(instructions[0].keys.length).toBe(2);
    });
  });

  describe('updatePrimarySaleHappenedViaToken', () => {
    it('pushes one instruction with raw byte 4', async () => {
      const instructions: any[] = [];
      await updatePrimarySaleHappenedViaToken(
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].data[0]).toBe(4);
      expect(instructions[0].keys.length).toBe(3);
    });
  });

  describe('mintPrintingTokens', () => {
    it('pushes one instruction with 7 account keys', async () => {
      const instructions: any[] = [];
      await mintPrintingTokens(
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        new BN(5),
        instructions,
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(7);
      expect(instructions[0].data[0]).toBe(9);
    });
  });
});

describe('Metadata PDA derivation', () => {
  describe('getEdition', () => {
    it('is deterministic', async () => {
      const mint = randomPubkey();
      const a = await getEdition(mint);
      const b = await getEdition(mint);
      expect(a.toBase58()).toBe(b.toBase58());
    });

    it('uses EDITION seed', async () => {
      const mint = randomPubkey();
      const PROGRAM_IDS = programIds();
      const manual = (
        await PublicKey.findProgramAddress(
          [
            Buffer.from(METADATA_PREFIX),
            PROGRAM_IDS.metadata.toBuffer(),
            mint.toBuffer(),
            Buffer.from(EDITION),
          ],
          PROGRAM_IDS.metadata,
        )
      )[0];

      expect((await getEdition(mint)).toBase58()).toBe(manual.toBase58());
    });
  });

  describe('getMetadata', () => {
    it('is deterministic', async () => {
      const mint = randomPubkey();
      const a = await getMetadata(mint);
      const b = await getMetadata(mint);
      expect(a.toBase58()).toBe(b.toBase58());
    });
  });

  describe('getReservationList', () => {
    it('is deterministic', async () => {
      const masterEdition = randomPubkey();
      const resource = randomPubkey();
      const a = await getReservationList(masterEdition, resource);
      const b = await getReservationList(masterEdition, resource);
      expect(a.toBase58()).toBe(b.toBase58());
    });

    it('uses RESERVATION seed', async () => {
      const masterEdition = randomPubkey();
      const resource = randomPubkey();
      const PROGRAM_IDS = programIds();

      const manual = (
        await PublicKey.findProgramAddress(
          [
            Buffer.from(METADATA_PREFIX),
            PROGRAM_IDS.metadata.toBuffer(),
            masterEdition.toBuffer(),
            Buffer.from(RESERVATION),
            resource.toBuffer(),
          ],
          PROGRAM_IDS.metadata,
        )
      )[0];

      expect(
        (await getReservationList(masterEdition, resource)).toBase58(),
      ).toBe(manual.toBase58());
    });
  });
});
