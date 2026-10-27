import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import BN from 'bn.js';
import '../../src/utils/borsh';
import {
  createAuction,
  startAuction,
  placeBid,
  cancelBid,
  getBidderPotKey,
  getAuctionExtended,
  AUCTION_PREFIX,
  EXTENDED,
  WinnerLimit,
  WinnerLimitType,
  PriceFloor,
  PriceFloorType,
} from '../../src/actions/auction';
import { programIds } from '../../src/utils/ids';

const randomPubkey = () =>
  new PublicKey(Buffer.alloc(32).fill(Math.random() * 255));

describe('Auction instruction builders', () => {
  describe('createAuction', () => {
    it('pushes one instruction with the auction programId', async () => {
      const instructions: any[] = [];
      const resource = randomPubkey();
      const authority = randomPubkey();
      const creator = randomPubkey();
      const tokenMint = randomPubkey();

      await createAuction(
        new WinnerLimit({ type: WinnerLimitType.Capped, usize: new BN(3) }),
        resource,
        new BN(9999999999),
        null,
        new PriceFloor({ type: PriceFloorType.None }),
        tokenMint,
        authority,
        creator,
        instructions,
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].programId.toBase58()).toBe(
        programIds().auction.toBase58(),
      );
    });

    it('includes 5 account keys with correct signer/writable flags', async () => {
      const instructions: any[] = [];
      await createAuction(
        new WinnerLimit({ type: WinnerLimitType.Capped, usize: new BN(1) }),
        randomPubkey(),
        new BN(100),
        null,
        new PriceFloor({ type: PriceFloorType.None }),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      const keys = instructions[0].keys;
      expect(keys.length).toBe(5);
      expect(keys[0].isSigner).toBe(true);
      expect(keys[0].isWritable).toBe(true);
      expect(keys[1].isWritable).toBe(true);
      expect(keys[2].isWritable).toBe(true);
      expect(keys[3].pubkey.toBase58()).toBe(SYSVAR_RENT_PUBKEY.toBase58());
      expect(keys[4].pubkey.toBase58()).toBe(
        SystemProgram.programId.toBase58(),
      );
    });

    it('instruction data starts with byte 1 (CreateAuction)', async () => {
      const instructions: any[] = [];
      await createAuction(
        new WinnerLimit({ type: WinnerLimitType.Capped, usize: new BN(1) }),
        randomPubkey(),
        null,
        null,
        new PriceFloor({ type: PriceFloorType.None }),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions[0].data[0]).toBe(1);
    });
  });

  describe('startAuction', () => {
    it('pushes one instruction with 3 account keys', async () => {
      const instructions: any[] = [];
      await startAuction(randomPubkey(), randomPubkey(), instructions);

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(3);
    });

    it('instruction data starts with byte 4 (StartAuction)', async () => {
      const instructions: any[] = [];
      await startAuction(randomPubkey(), randomPubkey(), instructions);
      expect(instructions[0].data[0]).toBe(4);
    });
  });

  describe('placeBid', () => {
    it('pushes one instruction with 14 account keys', async () => {
      const instructions: any[] = [];
      await placeBid(
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        new BN(1000),
        instructions,
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(14);
    });

    it('instruction data starts with byte 6 (PlaceBid)', async () => {
      const instructions: any[] = [];
      await placeBid(
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        new BN(500),
        instructions,
      );

      expect(instructions[0].data[0]).toBe(6);
    });

    it('returns the bid amount', async () => {
      const instructions: any[] = [];
      const amount = new BN(42000);
      const result = await placeBid(
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        amount,
        instructions,
      );

      expect(result!.amount.eq(amount)).toBe(true);
    });

    it('sets bidder as signer', async () => {
      const bidder = randomPubkey();
      const instructions: any[] = [];
      await placeBid(
        bidder,
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        new BN(100),
        instructions,
      );

      expect(instructions[0].keys[0].pubkey.toBase58()).toBe(bidder.toBase58());
      expect(instructions[0].keys[0].isSigner).toBe(true);
    });
  });

  describe('cancelBid', () => {
    it('pushes one instruction with 12 account keys', async () => {
      const instructions: any[] = [];
      await cancelBid(
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(12);
    });

    it('instruction data starts with byte 0 (CancelBid)', async () => {
      const instructions: any[] = [];
      await cancelBid(
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions[0].data[0]).toBe(0);
    });
  });
});

describe('Auction PDA derivation', () => {
  describe('getBidderPotKey', () => {
    it('returns a deterministic PDA', async () => {
      const auctionProgramId = programIds().auction;
      const auctionKey = randomPubkey();
      const bidderPubkey = randomPubkey();

      const key1 = await getBidderPotKey({
        auctionProgramId,
        auctionKey,
        bidderPubkey,
      });
      const key2 = await getBidderPotKey({
        auctionProgramId,
        auctionKey,
        bidderPubkey,
      });

      expect(key1.toBase58()).toBe(key2.toBase58());
    });

    it('different bidders produce different PDAs', async () => {
      const auctionProgramId = programIds().auction;
      const auctionKey = randomPubkey();

      const key1 = await getBidderPotKey({
        auctionProgramId,
        auctionKey,
        bidderPubkey: randomPubkey(),
      });
      const key2 = await getBidderPotKey({
        auctionProgramId,
        auctionKey,
        bidderPubkey: randomPubkey(),
      });

      expect(key1.toBase58()).not.toBe(key2.toBase58());
    });
  });

  describe('getAuctionExtended', () => {
    it('returns a deterministic PDA', async () => {
      const auctionProgramId = programIds().auction;
      const resource = randomPubkey();

      const key1 = await getAuctionExtended({ auctionProgramId, resource });
      const key2 = await getAuctionExtended({ auctionProgramId, resource });

      expect(key1.toBase58()).toBe(key2.toBase58());
    });

    it('uses EXTENDED prefix in derivation', async () => {
      const auctionProgramId = programIds().auction;
      const resource = randomPubkey();

      const extended = await getAuctionExtended({ auctionProgramId, resource });
      const manual = (
        await PublicKey.findProgramAddress(
          [
            Buffer.from(AUCTION_PREFIX),
            auctionProgramId.toBuffer(),
            resource.toBuffer(),
            Buffer.from(EXTENDED),
          ],
          auctionProgramId,
        )
      )[0];

      expect(extended.toBase58()).toBe(manual.toBase58());
    });
  });
});
