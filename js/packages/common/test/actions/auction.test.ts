import { PublicKey } from '@solana/web3.js';
import { serialize, deserializeUnchecked } from 'borsh';
import BN from 'bn.js';
import '../../src/utils/borsh';
import {
  AuctionData,
  AuctionDataExtended,
  AuctionState,
  Bid,
  BidState,
  BidStateType,
  BidderMetadata,
  BidderPot,
  PriceFloor,
  PriceFloorType,
  WinnerLimit,
  WinnerLimitType,
  AUCTION_SCHEMA,
  decodeAuction,
  decodeBidderMetadata,
  decodeBidderPot,
} from '../../src/actions/auction';

const randomPubkey = () =>
  new PublicKey(Buffer.alloc(32).fill(Math.random() * 255));

describe('Auction Borsh serialization', () => {
  describe('BidderMetadata', () => {
    it('round-trips through serialize/deserialize', () => {
      const original = new BidderMetadata({
        bidderPubkey: randomPubkey(),
        auctionPubkey: randomPubkey(),
        lastBid: new BN(5_000_000),
        lastBidTimestamp: new BN(1234567890),
        cancelled: false,
      });

      const data = Buffer.from(serialize(AUCTION_SCHEMA, original));
      const decoded = decodeBidderMetadata(data);

      expect(decoded.bidderPubkey.toBase58()).toBe(
        original.bidderPubkey.toBase58(),
      );
      expect(decoded.auctionPubkey.toBase58()).toBe(
        original.auctionPubkey.toBase58(),
      );
      expect(decoded.lastBid.eq(original.lastBid)).toBe(true);
      expect(decoded.lastBidTimestamp.eq(original.lastBidTimestamp)).toBe(true);
    });
  });

  describe('BidderPot', () => {
    it('round-trips through serialize/deserialize', () => {
      const original = new BidderPot({
        bidderPot: randomPubkey(),
        bidderAct: randomPubkey(),
        auctionAct: randomPubkey(),
        emptied: false,
      });

      const data = Buffer.from(serialize(AUCTION_SCHEMA, original));
      const decoded = decodeBidderPot(data);

      expect(decoded.bidderPot.toBase58()).toBe(original.bidderPot.toBase58());
      expect(decoded.bidderAct.toBase58()).toBe(original.bidderAct.toBase58());
      expect(decoded.auctionAct.toBase58()).toBe(
        original.auctionAct.toBase58(),
      );
    });
  });

  describe('AuctionData', () => {
    it('round-trips a Created auction with no bids', () => {
      const authority = randomPubkey();
      const tokenMint = randomPubkey();

      const original = new AuctionData({
        authority,
        tokenMint,
        lastBid: null,
        endedAt: null,
        endAuctionAt: new BN(9999999999),
        auctionGap: null,
        priceFloor: new PriceFloor({ type: PriceFloorType.None }),
        state: AuctionState.Created,
        bidState: new BidState({
          type: BidStateType.EnglishAuction,
          bids: [],
          max: new BN(3),
        }),
        totalUncancelledBids: new BN(0),
      });

      const data = Buffer.from(serialize(AUCTION_SCHEMA, original));
      const decoded = decodeAuction(data);

      expect(decoded.authority.toBase58()).toBe(authority.toBase58());
      expect(decoded.tokenMint.toBase58()).toBe(tokenMint.toBase58());
      expect(decoded.state).toBe(AuctionState.Created);
      expect(decoded.lastBid).toBeFalsy();
      expect(decoded.endAuctionAt!.eq(new BN(9999999999))).toBe(true);
    });

    it('round-trips with bids present', () => {
      const bidder1 = randomPubkey();
      const bidder2 = randomPubkey();

      const original = new AuctionData({
        authority: randomPubkey(),
        tokenMint: randomPubkey(),
        lastBid: new BN(200),
        endedAt: null,
        endAuctionAt: new BN(9999999999),
        auctionGap: new BN(300),
        priceFloor: new PriceFloor({
          type: PriceFloorType.Minimum,
          minPrice: new BN(100),
        }),
        state: AuctionState.Started,
        bidState: new BidState({
          type: BidStateType.EnglishAuction,
          bids: [
            new Bid({ key: bidder1, amount: new BN(150) }),
            new Bid({ key: bidder2, amount: new BN(200) }),
          ],
          max: new BN(2),
        }),
        totalUncancelledBids: new BN(2),
      });

      const data = Buffer.from(serialize(AUCTION_SCHEMA, original));
      const decoded = decodeAuction(data);

      expect(decoded.state).toBe(AuctionState.Started);
      expect(decoded.bidState.bids.length).toBe(2);
      expect(decoded.bidState.bids[0].key.toBase58()).toBe(bidder1.toBase58());
      expect(decoded.bidState.bids[0].amount.eq(new BN(150))).toBe(true);
      expect(decoded.bidState.bids[1].amount.eq(new BN(200))).toBe(true);
      expect(decoded.auctionGap!.eq(new BN(300))).toBe(true);
    });
  });

  describe('AuctionDataExtended', () => {
    it('round-trips with all fields', () => {
      const original = new AuctionDataExtended({
        totalUncancelledBids: new BN(5),
        tickSize: new BN(1000),
        gapTickSizePercentage: 10,
      });

      const data = Buffer.from(serialize(AUCTION_SCHEMA, original));
      const decoded = deserializeUnchecked(
        AUCTION_SCHEMA,
        AuctionDataExtended,
        data,
      ) as AuctionDataExtended;

      expect(decoded.totalUncancelledBids.eq(new BN(5))).toBe(true);
      expect(decoded.tickSize!.eq(new BN(1000))).toBe(true);
      expect(decoded.gapTickSizePercentage).toBe(10);
    });

    it('round-trips with null optional fields', () => {
      const original = new AuctionDataExtended({
        totalUncancelledBids: new BN(0),
        tickSize: null,
        gapTickSizePercentage: null,
      });

      const data = Buffer.from(serialize(AUCTION_SCHEMA, original));
      const decoded = deserializeUnchecked(
        AUCTION_SCHEMA,
        AuctionDataExtended,
        data,
      ) as AuctionDataExtended;

      expect(decoded.tickSize).toBeFalsy();
      expect(decoded.gapTickSizePercentage).toBeFalsy();
    });
  });
});

describe('PriceFloor', () => {
  it('sets minPrice in hash for Minimum type', () => {
    const floor = new PriceFloor({
      type: PriceFloorType.Minimum,
      minPrice: new BN(1_000_000),
    });
    expect(floor.type).toBe(PriceFloorType.Minimum);
    const embeddedPrice = new BN(floor.hash.slice(0, 8), 'le');
    expect(embeddedPrice.eq(new BN(1_000_000))).toBe(true);
  });

  it('reads minPrice from hash when no minPrice arg provided', () => {
    const hash = new Uint8Array(32);
    const price = new BN(42);
    hash.set(price.toArrayLike(Buffer, 'le', 8), 0);

    const floor = new PriceFloor({
      type: PriceFloorType.Minimum,
      hash,
    });
    expect(floor.minPrice!.eq(new BN(42))).toBe(true);
  });

  it('defaults to zeroed hash for None type', () => {
    const floor = new PriceFloor({ type: PriceFloorType.None });
    expect(floor.hash.every(b => b === 0)).toBe(true);
  });
});

describe('BidState.getWinnerIndex', () => {
  it('returns index for the highest bidder', () => {
    const bidder1 = randomPubkey();
    const bidder2 = randomPubkey();

    const state = new BidState({
      type: BidStateType.EnglishAuction,
      bids: [
        new Bid({ key: bidder1, amount: new BN(100) }),
        new Bid({ key: bidder2, amount: new BN(200) }),
      ],
      max: new BN(2),
    });

    expect(state.getWinnerIndex(bidder2)).toBe(0);
    expect(state.getWinnerIndex(bidder1)).toBe(1);
  });

  it('returns null for a bidder not in the list', () => {
    const state = new BidState({
      type: BidStateType.EnglishAuction,
      bids: [new Bid({ key: randomPubkey(), amount: new BN(100) })],
      max: new BN(1),
    });

    expect(state.getWinnerIndex(randomPubkey())).toBeNull();
  });

  it('returns null when bidder is outside max winners', () => {
    const loser = randomPubkey();
    const winner = randomPubkey();

    const state = new BidState({
      type: BidStateType.EnglishAuction,
      bids: [
        new Bid({ key: loser, amount: new BN(50) }),
        new Bid({ key: winner, amount: new BN(200) }),
      ],
      max: new BN(1),
    });

    expect(state.getWinnerIndex(winner)).toBe(0);
    expect(state.getWinnerIndex(loser)).toBeNull();
  });

  it('returns null when bids is undefined/empty', () => {
    const state = new BidState({
      type: BidStateType.EnglishAuction,
      bids: [],
      max: new BN(3),
    });

    expect(state.getWinnerIndex(randomPubkey())).toBeNull();
  });
});

describe('WinnerLimit', () => {
  it('serializes Capped variant', () => {
    const wl = new WinnerLimit({
      type: WinnerLimitType.Capped,
      usize: new BN(5),
    });
    const data = Buffer.from(serialize(AUCTION_SCHEMA, wl));
    const decoded = deserializeUnchecked(
      AUCTION_SCHEMA,
      WinnerLimit,
      data,
    ) as WinnerLimit;
    expect(decoded.type).toBe(WinnerLimitType.Capped);
    expect(decoded.usize.eq(new BN(5))).toBe(true);
  });

  it('serializes Unlimited variant', () => {
    const wl = new WinnerLimit({
      type: WinnerLimitType.Unlimited,
      usize: new BN(0),
    });
    const data = Buffer.from(serialize(AUCTION_SCHEMA, wl));
    const decoded = deserializeUnchecked(
      AUCTION_SCHEMA,
      WinnerLimit,
      data,
    ) as WinnerLimit;
    expect(decoded.type).toBe(WinnerLimitType.Unlimited);
  });
});
