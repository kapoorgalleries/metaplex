import { PublicKey } from '@solana/web3.js';
import { serialize, deserializeUnchecked } from 'borsh';
import BN from 'bn.js';
import '../../src/utils/borsh';
import {
  Creator,
  Data,
  Edition,
  MasterEdition,
  Metadata,
  MetadataKey,
  Reservation,
  ReservationList,
  METADATA_SCHEMA,
  decodeEdition,
  decodeMasterEdition,
  MAX_NAME_LENGTH,
  MAX_SYMBOL_LENGTH,
  MAX_URI_LENGTH,
  MAX_CREATOR_LIMIT,
  MAX_CREATOR_LEN,
  MAX_METADATA_LEN,
} from '../../src/actions/metadata';

const randomPubkey = () =>
  new PublicKey(Buffer.alloc(32).fill(Math.random() * 255));

describe('Metadata Borsh serialization', () => {
  describe('Data', () => {
    it('round-trips with creators', () => {
      const creator = new Creator({
        address: randomPubkey(),
        verified: true,
        share: 100,
      });

      const original = new Data({
        name: 'Test NFT',
        symbol: 'TNFT',
        uri: 'https://example.com/metadata.json',
        sellerFeeBasisPoints: 500,
        creators: [creator],
      });

      const data = Buffer.from(serialize(METADATA_SCHEMA, original));
      const decoded = deserializeUnchecked(METADATA_SCHEMA, Data, data) as Data;

      expect(decoded.name).toBe('Test NFT');
      expect(decoded.symbol).toBe('TNFT');
      expect(decoded.uri).toBe('https://example.com/metadata.json');
      expect(decoded.sellerFeeBasisPoints).toBe(500);
      expect(decoded.creators!.length).toBe(1);
      expect(decoded.creators![0].address.toBase58()).toBe(
        creator.address.toBase58(),
      );
      expect(decoded.creators![0].share).toBe(100);
    });

    it('round-trips with null creators', () => {
      const original = new Data({
        name: 'No Creator NFT',
        symbol: 'NC',
        uri: 'https://example.com',
        sellerFeeBasisPoints: 0,
        creators: null,
      });

      const data = Buffer.from(serialize(METADATA_SCHEMA, original));
      const decoded = deserializeUnchecked(METADATA_SCHEMA, Data, data) as Data;
      expect(decoded.creators).toBeFalsy();
    });

    it('round-trips with multiple creators', () => {
      const creators = Array.from(
        { length: 3 },
        (_, i) =>
          new Creator({
            address: randomPubkey(),
            verified: i === 0,
            share: i === 0 ? 60 : 20,
          }),
      );

      const original = new Data({
        name: 'Multi',
        symbol: 'M',
        uri: 'https://example.com',
        sellerFeeBasisPoints: 250,
        creators,
      });

      const data = Buffer.from(serialize(METADATA_SCHEMA, original));
      const decoded = deserializeUnchecked(METADATA_SCHEMA, Data, data) as Data;
      expect(decoded.creators!.length).toBe(3);
      expect(decoded.creators![0].share).toBe(60);
      expect(decoded.creators![1].share).toBe(20);
    });
  });

  describe('Metadata', () => {
    it('round-trips full metadata', () => {
      const mint = randomPubkey();
      const updateAuth = randomPubkey();

      const original = new Metadata({
        updateAuthority: updateAuth,
        mint,
        data: new Data({
          name: 'My NFT',
          symbol: 'MNFT',
          uri: 'https://arweave.net/abc123',
          sellerFeeBasisPoints: 1000,
          creators: [
            new Creator({
              address: randomPubkey(),
              verified: true,
              share: 100,
            }),
          ],
        }),
        primarySaleHappened: false,
        isMutable: true,
      });

      const data = Buffer.from(serialize(METADATA_SCHEMA, original));
      const decoded = deserializeUnchecked(
        METADATA_SCHEMA,
        Metadata,
        data,
      ) as Metadata;

      expect(decoded.key).toBe(MetadataKey.MetadataV1);
      expect(decoded.updateAuthority.toBase58()).toBe(updateAuth.toBase58());
      expect(decoded.mint.toBase58()).toBe(mint.toBase58());
      expect(decoded.data.name).toBe('My NFT');
      expect(decoded.data.sellerFeeBasisPoints).toBe(1000);
    });
  });

  describe('Edition', () => {
    it('round-trips', () => {
      const parent = randomPubkey();
      const original = new Edition({
        key: MetadataKey.EditionV1,
        parent,
        edition: new BN(42),
      });

      const data = Buffer.from(serialize(METADATA_SCHEMA, original));
      const decoded = decodeEdition(data);

      expect(decoded.key).toBe(MetadataKey.EditionV1);
      expect(decoded.parent.toBase58()).toBe(parent.toBase58());
      expect(decoded.edition.eq(new BN(42))).toBe(true);
    });
  });

  describe('MasterEdition', () => {
    it('round-trips with maxSupply', () => {
      const printingMint = randomPubkey();
      const oneTimeMint = randomPubkey();

      const original = new MasterEdition({
        key: MetadataKey.MasterEditionV1,
        supply: new BN(0),
        maxSupply: new BN(100),
        printingMint,
        oneTimePrintingAuthorizationMint: oneTimeMint,
      });

      const data = Buffer.from(serialize(METADATA_SCHEMA, original));
      const decoded = decodeMasterEdition(data);

      expect(decoded.key).toBe(MetadataKey.MasterEditionV1);
      expect(decoded.supply.eq(new BN(0))).toBe(true);
      expect(decoded.maxSupply!.eq(new BN(100))).toBe(true);
      expect(decoded.printingMint.toBase58()).toBe(printingMint.toBase58());
      expect(decoded.oneTimePrintingAuthorizationMint.toBase58()).toBe(
        oneTimeMint.toBase58(),
      );
    });

    it('round-trips with undefined maxSupply', () => {
      const original = new MasterEdition({
        key: MetadataKey.MasterEditionV1,
        supply: new BN(10),
        maxSupply: undefined,
        printingMint: randomPubkey(),
        oneTimePrintingAuthorizationMint: randomPubkey(),
      });

      const data = Buffer.from(serialize(METADATA_SCHEMA, original));
      const decoded = decodeMasterEdition(data);
      expect(decoded.maxSupply).toBeUndefined();
    });
  });

  describe('ReservationList', () => {
    it('round-trips with reservations', () => {
      const masterEdition = randomPubkey();
      const reservation = new Reservation({
        address: randomPubkey(),
        spotsRemaining: 5,
        totalSpots: 10,
      });

      const original = new ReservationList({
        key: MetadataKey.ReservationListV1,
        masterEdition,
        supplySnapshot: new BN(100),
        reservations: [reservation],
      });

      const data = Buffer.from(serialize(METADATA_SCHEMA, original));
      const decoded = deserializeUnchecked(
        METADATA_SCHEMA,
        ReservationList,
        data,
      ) as ReservationList;

      expect(decoded.masterEdition.toBase58()).toBe(masterEdition.toBase58());
      expect(decoded.supplySnapshot!.eq(new BN(100))).toBe(true);
      expect(decoded.reservations.length).toBe(1);
      expect(decoded.reservations[0].spotsRemaining).toBe(5);
      expect(decoded.reservations[0].totalSpots).toBe(10);
    });

    it('round-trips with null supplySnapshot', () => {
      const original = new ReservationList({
        key: MetadataKey.ReservationListV1,
        masterEdition: randomPubkey(),
        supplySnapshot: null,
        reservations: [],
      });

      const data = Buffer.from(serialize(METADATA_SCHEMA, original));
      const decoded = deserializeUnchecked(
        METADATA_SCHEMA,
        ReservationList,
        data,
      ) as ReservationList;

      expect(decoded.supplySnapshot).toBeFalsy();
      expect(decoded.reservations.length).toBe(0);
    });
  });
});

describe('Metadata constants', () => {
  it('MAX_CREATOR_LEN accounts for pubkey + verified + share', () => {
    expect(MAX_CREATOR_LEN).toBe(32 + 1 + 1);
  });

  it('MAX_METADATA_LEN sums correctly', () => {
    const expected =
      1 +
      32 +
      32 +
      MAX_NAME_LENGTH +
      MAX_SYMBOL_LENGTH +
      MAX_URI_LENGTH +
      MAX_CREATOR_LIMIT * MAX_CREATOR_LEN +
      1 +
      1 +
      200;
    expect(MAX_METADATA_LEN).toBe(expected);
  });
});
