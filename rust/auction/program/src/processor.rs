use crate::errors::AuctionError;
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo, borsh::try_from_slice_unchecked, clock::UnixTimestamp,
    entrypoint::ProgramResult, hash::Hash, msg, program_error::ProgramError, pubkey::Pubkey,
};
use std::{cmp, mem};

// Declare submodules, each contains a single handler for each instruction variant in the program.
pub mod cancel_bid;
pub mod claim_bid;
pub mod create_auction;
pub mod end_auction;
pub mod place_bid;
pub mod set_authority;
pub mod start_auction;

// Re-export submodules handlers + associated types for other programs to consume.
pub use cancel_bid::*;
pub use claim_bid::*;
pub use create_auction::*;
pub use end_auction::*;
pub use place_bid::*;
pub use set_authority::*;
pub use start_auction::*;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    input: &[u8],
) -> ProgramResult {
    use crate::instruction::AuctionInstruction;
    match AuctionInstruction::try_from_slice(input)? {
        AuctionInstruction::CancelBid(args) => cancel_bid(program_id, accounts, args),
        AuctionInstruction::ClaimBid(args) => claim_bid(program_id, accounts, args),
        AuctionInstruction::CreateAuction(args) => create_auction(program_id, accounts, args),
        AuctionInstruction::EndAuction(args) => end_auction(program_id, accounts, args),
        AuctionInstruction::PlaceBid(args) => place_bid(program_id, accounts, args),
        AuctionInstruction::SetAuthority => set_authority(program_id, accounts),
        AuctionInstruction::StartAuction(args) => start_auction(program_id, accounts, args),
    }
}

/// Structure with pricing floor data.
#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub enum PriceFloor {
    /// Due to borsh on the front end disallowing different arguments in enums, we have to make sure data is
    /// same size across all three
    /// No price floor, any bid is valid.
    None([u8; 32]),
    /// Explicit minimum price, any bid below this is rejected.
    MinimumPrice([u64; 4]),
    /// Hidden minimum price, revealed at the end of the auction.
    BlindedPrice(Hash),
}

// The two extra 8's are present, one 8 is for the Vec's amount of elements and one is for the max
// usize in bid state.
pub const BASE_AUCTION_DATA_SIZE: usize = 32 + 32 + 9 + 9 + 9 + 9 + 1 + 32 + 1 + 8 + 8 + 8;
#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub struct AuctionData {
    /// Pubkey of the authority with permission to modify this auction.
    pub authority: Pubkey,
    /// Pubkey of the resource being bid on.
    /// TODO try to bring this back some day. Had to remove this due to a stack access violation bug
    /// interactin that happens in metaplex during redemptions due to some low level rust error
    /// that happens when AuctionData has too many fields. This field was the least used.
    ///pub resource: Pubkey,
    /// Token mint for the SPL token being used to bid
    pub token_mint: Pubkey,
    /// The time the last bid was placed, used to keep track of auction timing.
    pub last_bid: Option<UnixTimestamp>,
    /// Slot time the auction was officially ended by.
    pub ended_at: Option<UnixTimestamp>,
    /// End time is the cut-off point that the auction is forced to end by.
    pub end_auction_at: Option<UnixTimestamp>,
    /// Gap time is the amount of time in slots after the previous bid at which the auction ends.
    pub end_auction_gap: Option<UnixTimestamp>,
    /// Minimum price for any bid to meet.
    pub price_floor: PriceFloor,
    /// The state the auction is in, whether it has started or ended.
    pub state: AuctionState,
    /// Auction Bids, each user may have one bid open at a time.
    pub bid_state: BidState,
}

pub const MAX_AUCTION_DATA_EXTENDED_SIZE: usize = 8 + 9 + 2 + 200;
// Further storage for more fields. Would like to store more on the main data but due
// to a borsh issue that causes more added fields to inflict "Access violation" errors
// during redemption in main Metaplex app for no reason, we had to add this nasty PDA.
#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub struct AuctionDataExtended {
    /// Total uncancelled bids
    pub total_uncancelled_bids: u64,
    // Unimplemented fields
    /// Tick size
    pub tick_size: Option<u64>,
    /// gap_tick_size_percentage - two decimal points
    pub gap_tick_size_percentage: Option<u8>,
}

impl AuctionDataExtended {
    pub fn from_account_info(a: &AccountInfo) -> Result<AuctionDataExtended, ProgramError> {
        if a.data_len() != MAX_AUCTION_DATA_EXTENDED_SIZE {
            return Err(AuctionError::DataTypeMismatch.into());
        }

        let auction_extended: AuctionDataExtended = try_from_slice_unchecked(&a.data.borrow_mut())?;

        Ok(auction_extended)
    }
}

impl AuctionData {
    pub fn from_account_info(a: &AccountInfo) -> Result<AuctionData, ProgramError> {
        if (a.data_len() - BASE_AUCTION_DATA_SIZE) % mem::size_of::<Bid>() != 0 {
            return Err(AuctionError::DataTypeMismatch.into());
        }

        let auction: AuctionData = try_from_slice_unchecked(&a.data.borrow_mut())?;

        Ok(auction)
    }

    pub fn ended(&self, now: UnixTimestamp) -> Result<bool, ProgramError> {
        // If there is an end time specified, handle conditions.
        return match (self.ended_at, self.end_auction_gap) {
            // NOTE if changing this, change in auction.ts on front end as well where logic duplicates.
            // Both end and gap present, means a bid can still be placed post-auction if it is
            // within the gap time.
            (Some(end), Some(gap)) => {
                // Check if the bid is within the gap between the last bidder.
                if let Some(last) = self.last_bid {
                    let next_bid_time = match last.checked_add(gap) {
                        Some(val) => val,
                        None => return Err(AuctionError::NumericalOverflowError.into()),
                    };
                    Ok(now > end && now > next_bid_time)
                } else {
                    Ok(now > end)
                }
            }

            // Simply whether now has passed the end.
            (Some(end), None) => Ok(now > end),

            // No other end conditions.
            _ => Ok(false),
        };
    }

    pub fn is_winner(&self, key: &Pubkey) -> Option<usize> {
        let minimum = match self.price_floor {
            PriceFloor::MinimumPrice(min) => min[0],
            _ => 0,
        };
        self.bid_state.is_winner(key, minimum)
    }

    pub fn num_winners(&self) -> u64 {
        let minimum = match self.price_floor {
            PriceFloor::MinimumPrice(min) => min[0],
            _ => 0,
        };
        self.bid_state.num_winners(minimum)
    }

    pub fn winner_at(&self, idx: usize) -> Option<Pubkey> {
        let minimum = match self.price_floor {
            PriceFloor::MinimumPrice(min) => min[0],
            _ => 0,
        };
        self.bid_state.winner_at(idx, minimum)
    }
}

/// Define valid auction state transitions.
#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub enum AuctionState {
    Created,
    Started,
    Ended,
}

impl AuctionState {
    pub fn create() -> Self {
        AuctionState::Created
    }

    #[inline(always)]
    pub fn start(self) -> Result<Self, ProgramError> {
        match self {
            AuctionState::Created => Ok(AuctionState::Started),
            _ => Err(AuctionError::AuctionTransitionInvalid.into()),
        }
    }

    #[inline(always)]
    pub fn end(self) -> Result<Self, ProgramError> {
        match self {
            AuctionState::Started => Ok(AuctionState::Ended),
            _ => Err(AuctionError::AuctionTransitionInvalid.into()),
        }
    }
}

/// Bids associate a bidding key with an amount bid.
#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub struct Bid(pub Pubkey, pub u64);

/// BidState tracks the running state of an auction, each variant represents a different kind of
/// auction being run.
#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub enum BidState {
    EnglishAuction { bids: Vec<Bid>, max: usize },
    OpenEdition { bids: Vec<Bid>, max: usize },
}

/// Bidding Implementations.
///
/// English Auction: this stores only the current winning bids in the auction, pruning cancelled
/// and lost bids over time.
///
/// Open Edition: All bids are accepted, cancellations return money to the bidder and always
/// succeed.
impl BidState {
    pub fn new_english(n: usize) -> Self {
        BidState::EnglishAuction {
            bids: vec![],
            max: n,
        }
    }

    pub fn new_open_edition() -> Self {
        BidState::OpenEdition {
            bids: vec![],
            max: 0,
        }
    }

    pub fn max_array_size_for(n: usize) -> usize {
        let mut real_max = n;
        if real_max < 8 {
            real_max = 8;
        } else {
            real_max = 2 * real_max
        }
        real_max
    }

    /// Push a new bid into the state, this succeeds only if the bid is larger than the current top
    /// winner stored. Crappy list information to start with.
    pub fn place_bid(&mut self, bid: Bid) -> Result<(), ProgramError> {
        match self {
            // In a capped auction, track the limited number of winners.
            BidState::EnglishAuction { ref mut bids, max } => match bids.last() {
                Some(top) => {
                    msg!("Looking to go over the loop");
                    for i in (0..bids.len()).rev() {
                        msg!("Comparison of {:?} and {:?} for {:?}", bids[i].1, bid.1, i);
                        if bids[i].1 < bid.1 {
                            msg!("Ok we can do an insert");
                            if i + 1 < bids.len() {
                                msg!("Doing a normal insert");
                                bids.insert(i + 1, bid);
                            } else {
                                msg!("Doing an on the end insert");
                                bids.push(bid)
                            }
                            break;
                        } else if bids[i].1 == bid.1 {
                            msg!("Ok we can do an equivalent insert");
                            if i == 0 {
                                msg!("Doing a normal insert");
                                bids.insert(0, bid);
                                break;
                            } else {
                                if bids[i - 1].1 != bids[i].1 {
                                    msg!("Doing an insert just before");
                                    bids.insert(i, bid);
                                    break;
                                }
                                msg!("More duplicates ahead...")
                            }
                        } else if i == 0 {
                            msg!("Inserting at 0");
                            bids.insert(0, bid);
                            break;
                        }
                    }
                    let max_size = BidState::max_array_size_for(*max);

                    if bids.len() > max_size {
                        bids.remove(0);
                    }
                    Ok(())
                }
                _ => {
                    msg!("Pushing bid onto stack");
                    bids.push(bid);
                    Ok(())
                }
            },

            // In an open auction, bidding simply succeeds.
            BidState::OpenEdition { bids, max } => Ok(()),
        }
    }

    /// Cancels a bid, if the bid was a winning bid it is removed, if the bid is invalid the
    /// function simple no-ops.
    pub fn cancel_bid(&mut self, key: Pubkey) -> Result<(), ProgramError> {
        match self {
            BidState::EnglishAuction { ref mut bids, max } => {
                bids.retain(|b| b.0 != key);
                Ok(())
            }

            // In an open auction, cancelling simply succeeds. It's up to the manager of an auction
            // to decide what to do with open edition bids.
            BidState::OpenEdition { bids, max } => Ok(()),
        }
    }

    pub fn amount(&self, index: usize) -> u64 {
        match self {
            BidState::EnglishAuction { bids, max } => {
                if index >= 0 as usize && index < bids.len() {
                    return bids[bids.len() - index - 1].1;
                } else {
                    return 0;
                }
            }
            BidState::OpenEdition { bids, max } => 0,
        }
    }

    /// Check if a pubkey is currently a winner and return winner #1 as index 0 to outside world.
    pub fn is_winner(&self, key: &Pubkey, min: u64) -> Option<usize> {
        // NOTE if changing this, change in auction.ts on front end as well where logic duplicates.

        match self {
            // Presense in the winner list is enough to check win state.
            BidState::EnglishAuction { bids, max } => {
                match bids.iter().position(|bid| &bid.0 == key && bid.1 >= min) {
                    Some(val) => {
                        let zero_based_index = bids.len() - val - 1;
                        if zero_based_index < *max {
                            Some(zero_based_index)
                        } else {
                            None
                        }
                    }
                    None => None,
                }
            }
            // There are no winners in an open edition, it is up to the auction manager to decide
            // what to do with open edition bids.
            BidState::OpenEdition { bids, max } => None,
        }
    }

    pub fn num_winners(&self, min: u64) -> u64 {
        match self {
            BidState::EnglishAuction { bids, max } => cmp::min(
                bids.iter()
                    .filter(|b| b.1 >= min)
                    .collect::<Vec<&Bid>>()
                    .len(),
                *max,
            ) as u64,
            BidState::OpenEdition { bids, max } => 0,
        }
    }

    // Idea is to present winner as index 0 to outside world
    pub fn winner_at(&self, index: usize, min: u64) -> Option<Pubkey> {
        match self {
            BidState::EnglishAuction { bids, max } => {
                if index < *max && index < bids.len() {
                    let bid = &bids[bids.len() - index - 1];
                    if bid.1 >= min {
                        Some(bids[bids.len() - index - 1].0)
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            BidState::OpenEdition { bids, max } => None,
        }
    }
}

#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub enum WinnerLimit {
    Unlimited(usize),
    Capped(usize),
}

pub const BIDDER_METADATA_LEN: usize = 32 + 32 + 8 + 8 + 1;
/// Models a set of metadata for a bidder, meant to be stored in a PDA. This allows looking up
/// information about a bidder regardless of if they have won, lost or cancelled.
#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, PartialEq, Debug)]
pub struct BidderMetadata {
    // Relationship with the bidder who's metadata this covers.
    pub bidder_pubkey: Pubkey,
    // Relationship with the auction this bid was placed on.
    pub auction_pubkey: Pubkey,
    // Amount that the user bid.
    pub last_bid: u64,
    // Tracks the last time this user bid.
    pub last_bid_timestamp: UnixTimestamp,
    // Whether the last bid the user made was cancelled. This should also be enough to know if the
    // user is a winner, as if cancelled it implies previous bids were also cancelled.
    pub cancelled: bool,
}

impl BidderMetadata {
    pub fn from_account_info(a: &AccountInfo) -> Result<BidderMetadata, ProgramError> {
        if a.data_len() != BIDDER_METADATA_LEN {
            return Err(AuctionError::DataTypeMismatch.into());
        }

        let bidder_meta: BidderMetadata = try_from_slice_unchecked(&a.data.borrow_mut())?;

        Ok(bidder_meta)
    }
}

#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, PartialEq)]
pub struct BidderPot {
    /// Points at actual pot that is a token account
    pub bidder_pot: Pubkey,
    /// Originating bidder account
    pub bidder_act: Pubkey,
    /// Auction account
    pub auction_act: Pubkey,
    /// emptied or not
    pub emptied: bool,
}

impl BidderPot {
    pub fn from_account_info(a: &AccountInfo) -> Result<BidderPot, ProgramError> {
        if a.data_len() != mem::size_of::<BidderPot>() {
            return Err(AuctionError::DataTypeMismatch.into());
        }

        let bidder_pot: BidderPot = try_from_slice_unchecked(&a.data.borrow_mut())?;

        Ok(bidder_pot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use borsh::{BorshDeserialize, BorshSerialize};

    fn test_pubkey(seed: u8) -> Pubkey {
        let mut bytes = [0u8; 32];
        bytes[0] = seed;
        Pubkey::new_from_array(bytes)
    }

    // ── AuctionState transitions ──

    #[test]
    fn created_can_start() {
        assert_eq!(
            AuctionState::Created.start().unwrap(),
            AuctionState::Started
        );
    }

    #[test]
    fn started_can_end() {
        assert_eq!(AuctionState::Started.end().unwrap(), AuctionState::Ended);
    }

    #[test]
    fn started_cannot_start() {
        assert!(AuctionState::Started.start().is_err());
    }

    #[test]
    fn ended_cannot_end() {
        assert!(AuctionState::Ended.end().is_err());
    }

    #[test]
    fn created_cannot_end() {
        assert!(AuctionState::Created.end().is_err());
    }

    #[test]
    fn ended_cannot_start() {
        assert!(AuctionState::Ended.start().is_err());
    }

    // ── BidState::new_english / new_open_edition ──

    #[test]
    fn new_english_starts_empty() {
        let state = BidState::new_english(3);
        match state {
            BidState::EnglishAuction { bids, max } => {
                assert!(bids.is_empty());
                assert_eq!(max, 3);
            }
            _ => panic!("expected EnglishAuction"),
        }
    }

    #[test]
    fn new_open_edition_starts_empty() {
        let state = BidState::new_open_edition();
        match state {
            BidState::OpenEdition { bids, max } => {
                assert!(bids.is_empty());
                assert_eq!(max, 0);
            }
            _ => panic!("expected OpenEdition"),
        }
    }

    // ── BidState::place_bid ──

    #[test]
    fn place_bid_on_empty() {
        let mut state = BidState::new_english(3);
        state.place_bid(Bid(test_pubkey(1), 100)).unwrap();
        assert_eq!(state.amount(0), 100);
    }

    #[test]
    fn place_bid_maintains_sorted_order() {
        let mut state = BidState::new_english(3);
        state.place_bid(Bid(test_pubkey(1), 100)).unwrap();
        state.place_bid(Bid(test_pubkey(2), 300)).unwrap();
        state.place_bid(Bid(test_pubkey(3), 200)).unwrap();

        assert_eq!(state.amount(0), 300);
        assert_eq!(state.amount(1), 200);
        assert_eq!(state.amount(2), 100);
    }

    #[test]
    fn place_bid_handles_equal_amounts() {
        let mut state = BidState::new_english(5);
        state.place_bid(Bid(test_pubkey(1), 100)).unwrap();
        state.place_bid(Bid(test_pubkey(2), 100)).unwrap();
        state.place_bid(Bid(test_pubkey(3), 100)).unwrap();

        match &state {
            BidState::EnglishAuction { bids, .. } => {
                assert_eq!(bids.len(), 3);
                assert!(bids.iter().all(|b| b.1 == 100));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn place_bid_prunes_when_exceeding_max_array_size() {
        let mut state = BidState::new_english(1);
        let max_size = BidState::max_array_size_for(1);

        for i in 0..(max_size + 2) {
            state
                .place_bid(Bid(test_pubkey(i as u8), i as u64))
                .unwrap();
        }

        match &state {
            BidState::EnglishAuction { bids, .. } => {
                assert!(bids.len() <= max_size);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn place_bid_open_edition_always_succeeds() {
        let mut state = BidState::new_open_edition();
        assert!(state.place_bid(Bid(test_pubkey(1), 100)).is_ok());
    }

    // ── BidState::cancel_bid ──

    #[test]
    fn cancel_bid_removes_from_list() {
        let mut state = BidState::new_english(3);
        let bidder = test_pubkey(1);
        state.place_bid(Bid(bidder, 100)).unwrap();
        state.place_bid(Bid(test_pubkey(2), 200)).unwrap();

        state.cancel_bid(bidder).unwrap();

        match &state {
            BidState::EnglishAuction { bids, .. } => {
                assert_eq!(bids.len(), 1);
                assert_eq!(bids[0].0, test_pubkey(2));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn cancel_bid_noop_for_nonexistent_bidder() {
        let mut state = BidState::new_english(3);
        state.place_bid(Bid(test_pubkey(1), 100)).unwrap();
        state.cancel_bid(test_pubkey(99)).unwrap();

        match &state {
            BidState::EnglishAuction { bids, .. } => assert_eq!(bids.len(), 1),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn cancel_bid_open_edition_is_noop() {
        let mut state = BidState::new_open_edition();
        assert!(state.cancel_bid(test_pubkey(1)).is_ok());
    }

    // ── BidState::is_winner ──

    #[test]
    fn is_winner_returns_index_for_winner() {
        let mut state = BidState::new_english(2);
        let a = test_pubkey(1);
        let b = test_pubkey(2);
        state.place_bid(Bid(a, 100)).unwrap();
        state.place_bid(Bid(b, 200)).unwrap();

        assert_eq!(state.is_winner(&b, 0), Some(0));
        assert_eq!(state.is_winner(&a, 0), Some(1));
    }

    #[test]
    fn is_winner_returns_none_for_non_bidder() {
        let state = BidState::new_english(2);
        assert_eq!(state.is_winner(&test_pubkey(99), 0), None);
    }

    #[test]
    fn is_winner_respects_minimum_price() {
        let mut state = BidState::new_english(2);
        let bidder = test_pubkey(1);
        state.place_bid(Bid(bidder, 50)).unwrap();

        assert_eq!(state.is_winner(&bidder, 100), None);
        assert_eq!(state.is_winner(&bidder, 50), Some(0));
    }

    #[test]
    fn is_winner_returns_none_outside_max() {
        let mut state = BidState::new_english(1);
        let a = test_pubkey(1);
        let b = test_pubkey(2);
        state.place_bid(Bid(a, 100)).unwrap();
        state.place_bid(Bid(b, 200)).unwrap();

        assert_eq!(state.is_winner(&b, 0), Some(0));
        assert_eq!(state.is_winner(&a, 0), None);
    }

    #[test]
    fn is_winner_open_edition_always_none() {
        let state = BidState::new_open_edition();
        assert_eq!(state.is_winner(&test_pubkey(1), 0), None);
    }

    // ── BidState::num_winners ──

    #[test]
    fn num_winners_counts_qualifying_bids() {
        let mut state = BidState::new_english(5);
        state.place_bid(Bid(test_pubkey(1), 50)).unwrap();
        state.place_bid(Bid(test_pubkey(2), 100)).unwrap();
        state.place_bid(Bid(test_pubkey(3), 150)).unwrap();

        assert_eq!(state.num_winners(0), 3);
        assert_eq!(state.num_winners(100), 2);
        assert_eq!(state.num_winners(200), 0);
    }

    #[test]
    fn num_winners_capped_by_max() {
        let mut state = BidState::new_english(2);
        state.place_bid(Bid(test_pubkey(1), 100)).unwrap();
        state.place_bid(Bid(test_pubkey(2), 200)).unwrap();
        state.place_bid(Bid(test_pubkey(3), 300)).unwrap();

        assert_eq!(state.num_winners(0), 2);
    }

    #[test]
    fn num_winners_open_edition_is_zero() {
        let state = BidState::new_open_edition();
        assert_eq!(state.num_winners(0), 0);
    }

    // ── BidState::winner_at ──

    #[test]
    fn winner_at_returns_highest_first() {
        let mut state = BidState::new_english(3);
        let a = test_pubkey(1);
        let b = test_pubkey(2);
        let c = test_pubkey(3);
        state.place_bid(Bid(a, 100)).unwrap();
        state.place_bid(Bid(b, 200)).unwrap();
        state.place_bid(Bid(c, 300)).unwrap();

        assert_eq!(state.winner_at(0, 0), Some(c));
        assert_eq!(state.winner_at(1, 0), Some(b));
        assert_eq!(state.winner_at(2, 0), Some(a));
    }

    #[test]
    fn winner_at_respects_min() {
        let mut state = BidState::new_english(3);
        state.place_bid(Bid(test_pubkey(1), 50)).unwrap();
        state.place_bid(Bid(test_pubkey(2), 200)).unwrap();

        assert_eq!(state.winner_at(0, 0), Some(test_pubkey(2)));
        assert_eq!(state.winner_at(1, 100), None);
    }

    #[test]
    fn winner_at_returns_none_past_max() {
        let mut state = BidState::new_english(1);
        state.place_bid(Bid(test_pubkey(1), 100)).unwrap();
        state.place_bid(Bid(test_pubkey(2), 200)).unwrap();

        assert_eq!(state.winner_at(0, 0), Some(test_pubkey(2)));
        assert_eq!(state.winner_at(1, 0), None);
    }

    #[test]
    fn winner_at_open_edition_always_none() {
        let state = BidState::new_open_edition();
        assert_eq!(state.winner_at(0, 0), None);
    }

    // ── BidState::amount ──

    #[test]
    fn amount_returns_correct_value_by_index() {
        let mut state = BidState::new_english(3);
        state.place_bid(Bid(test_pubkey(1), 100)).unwrap();
        state.place_bid(Bid(test_pubkey(2), 200)).unwrap();
        state.place_bid(Bid(test_pubkey(3), 300)).unwrap();

        assert_eq!(state.amount(0), 300);
        assert_eq!(state.amount(1), 200);
        assert_eq!(state.amount(2), 100);
    }

    #[test]
    fn amount_returns_zero_for_out_of_bounds() {
        let state = BidState::new_english(3);
        assert_eq!(state.amount(0), 0);
        assert_eq!(state.amount(999), 0);
    }

    #[test]
    fn amount_open_edition_always_zero() {
        let state = BidState::new_open_edition();
        assert_eq!(state.amount(0), 0);
    }

    // ── BidState::max_array_size_for ──

    #[test]
    fn max_array_size_minimum_is_8() {
        assert_eq!(BidState::max_array_size_for(1), 8);
        assert_eq!(BidState::max_array_size_for(7), 8);
    }

    #[test]
    fn max_array_size_doubles_for_8_and_above() {
        assert_eq!(BidState::max_array_size_for(8), 16);
        assert_eq!(BidState::max_array_size_for(10), 20);
        assert_eq!(BidState::max_array_size_for(100), 200);
    }

    // ── AuctionData.ended() ──

    #[test]
    fn ended_returns_false_with_no_end_time() {
        let auction = AuctionData {
            authority: test_pubkey(0),
            token_mint: test_pubkey(1),
            last_bid: None,
            ended_at: None,
            end_auction_at: None,
            end_auction_gap: None,
            price_floor: PriceFloor::None([0u8; 32]),
            state: AuctionState::Started,
            bid_state: BidState::new_english(3),
        };
        assert_eq!(auction.ended(99999).unwrap(), false);
    }

    #[test]
    fn ended_returns_true_after_end_time() {
        let auction = AuctionData {
            authority: test_pubkey(0),
            token_mint: test_pubkey(1),
            last_bid: None,
            ended_at: Some(100),
            end_auction_at: Some(100),
            end_auction_gap: None,
            price_floor: PriceFloor::None([0u8; 32]),
            state: AuctionState::Started,
            bid_state: BidState::new_english(3),
        };
        assert_eq!(auction.ended(101).unwrap(), true);
        assert_eq!(auction.ended(99).unwrap(), false);
    }

    #[test]
    fn ended_with_gap_extends_past_last_bid() {
        let auction = AuctionData {
            authority: test_pubkey(0),
            token_mint: test_pubkey(1),
            last_bid: Some(90),
            ended_at: Some(100),
            end_auction_at: Some(100),
            end_auction_gap: Some(20),
            price_floor: PriceFloor::None([0u8; 32]),
            state: AuctionState::Started,
            bid_state: BidState::new_english(3),
        };
        // end=100, gap=20, last_bid=90 => next_bid_time=110
        // At 105: past end(100) but not past next_bid_time(110)
        assert_eq!(auction.ended(105).unwrap(), false);
        // At 111: past both
        assert_eq!(auction.ended(111).unwrap(), true);
    }

    #[test]
    fn ended_with_gap_but_no_bids() {
        let auction = AuctionData {
            authority: test_pubkey(0),
            token_mint: test_pubkey(1),
            last_bid: None,
            ended_at: Some(100),
            end_auction_at: Some(100),
            end_auction_gap: Some(20),
            price_floor: PriceFloor::None([0u8; 32]),
            state: AuctionState::Started,
            bid_state: BidState::new_english(3),
        };
        assert_eq!(auction.ended(101).unwrap(), true);
    }

    // ── AuctionData winner helpers ──

    #[test]
    fn is_winner_with_minimum_price_floor() {
        let bidder = test_pubkey(1);
        let mut bid_state = BidState::new_english(2);
        bid_state.place_bid(Bid(bidder, 200)).unwrap();

        let auction = AuctionData {
            authority: test_pubkey(0),
            token_mint: test_pubkey(2),
            last_bid: Some(100),
            ended_at: Some(200),
            end_auction_at: Some(200),
            end_auction_gap: None,
            price_floor: PriceFloor::MinimumPrice([150, 0, 0, 0]),
            state: AuctionState::Ended,
            bid_state,
        };

        assert_eq!(auction.is_winner(&bidder), Some(0));

        let loser = test_pubkey(99);
        assert_eq!(auction.is_winner(&loser), None);
    }

    #[test]
    fn num_winners_with_price_floor() {
        let mut bid_state = BidState::new_english(5);
        bid_state.place_bid(Bid(test_pubkey(1), 50)).unwrap();
        bid_state.place_bid(Bid(test_pubkey(2), 100)).unwrap();
        bid_state.place_bid(Bid(test_pubkey(3), 200)).unwrap();

        let auction = AuctionData {
            authority: test_pubkey(0),
            token_mint: test_pubkey(10),
            last_bid: None,
            ended_at: None,
            end_auction_at: None,
            end_auction_gap: None,
            price_floor: PriceFloor::MinimumPrice([100, 0, 0, 0]),
            state: AuctionState::Ended,
            bid_state,
        };

        assert_eq!(auction.num_winners(), 2);
    }

    #[test]
    fn winner_at_with_no_price_floor() {
        let mut bid_state = BidState::new_english(3);
        bid_state.place_bid(Bid(test_pubkey(1), 100)).unwrap();
        bid_state.place_bid(Bid(test_pubkey(2), 200)).unwrap();

        let auction = AuctionData {
            authority: test_pubkey(0),
            token_mint: test_pubkey(10),
            last_bid: None,
            ended_at: None,
            end_auction_at: None,
            end_auction_gap: None,
            price_floor: PriceFloor::None([0u8; 32]),
            state: AuctionState::Ended,
            bid_state,
        };

        assert_eq!(auction.winner_at(0), Some(test_pubkey(2)));
        assert_eq!(auction.winner_at(1), Some(test_pubkey(1)));
        assert_eq!(auction.winner_at(2), None);
    }

    // ── Borsh round-trip serialization ──

    #[test]
    fn bid_state_english_borsh_round_trip() {
        let mut state = BidState::new_english(3);
        state.place_bid(Bid(test_pubkey(1), 100)).unwrap();
        state.place_bid(Bid(test_pubkey(2), 200)).unwrap();

        let data = state.try_to_vec().unwrap();
        let decoded = BidState::try_from_slice(&data).unwrap();
        assert_eq!(state, decoded);
    }

    #[test]
    fn bid_state_open_edition_borsh_round_trip() {
        let state = BidState::new_open_edition();
        let data = state.try_to_vec().unwrap();
        let decoded = BidState::try_from_slice(&data).unwrap();
        assert_eq!(state, decoded);
    }

    #[test]
    fn auction_data_borsh_round_trip() {
        let mut bid_state = BidState::new_english(2);
        bid_state.place_bid(Bid(test_pubkey(1), 500)).unwrap();

        let auction = AuctionData {
            authority: test_pubkey(10),
            token_mint: test_pubkey(20),
            last_bid: Some(1234567890),
            ended_at: None,
            end_auction_at: Some(9999999999),
            end_auction_gap: Some(300),
            price_floor: PriceFloor::MinimumPrice([100, 0, 0, 0]),
            state: AuctionState::Started,
            bid_state,
        };

        let data = auction.try_to_vec().unwrap();
        let decoded = AuctionData::try_from_slice(&data).unwrap();
        assert_eq!(auction, decoded);
    }

    #[test]
    fn auction_data_extended_borsh_round_trip() {
        let ext = AuctionDataExtended {
            total_uncancelled_bids: 5,
            tick_size: Some(1000),
            gap_tick_size_percentage: Some(10),
        };

        let data = ext.try_to_vec().unwrap();
        let decoded = AuctionDataExtended::try_from_slice(&data).unwrap();
        assert_eq!(ext, decoded);
    }

    #[test]
    fn bidder_metadata_borsh_round_trip() {
        let meta = BidderMetadata {
            bidder_pubkey: test_pubkey(1),
            auction_pubkey: test_pubkey(2),
            last_bid: 5000,
            last_bid_timestamp: 1234567890,
            cancelled: false,
        };

        let data = meta.try_to_vec().unwrap();
        let decoded = BidderMetadata::try_from_slice(&data).unwrap();
        assert_eq!(meta, decoded);
    }

    #[test]
    fn price_floor_variants_borsh_round_trip() {
        let none = PriceFloor::None([0u8; 32]);
        let min = PriceFloor::MinimumPrice([42, 0, 0, 0]);
        let blinded = PriceFloor::BlindedPrice(Hash::new_from_array([0xAB; 32]));

        for original in &[none, min, blinded] {
            let data = original.try_to_vec().unwrap();
            let decoded = PriceFloor::try_from_slice(&data).unwrap();
            assert_eq!(original, &decoded);
        }
    }

    #[test]
    fn winner_limit_variants_borsh_round_trip() {
        let unlimited = WinnerLimit::Unlimited(0);
        let capped = WinnerLimit::Capped(5);

        for original in &[unlimited, capped] {
            let data = original.try_to_vec().unwrap();
            let decoded = WinnerLimit::try_from_slice(&data).unwrap();
            assert_eq!(original, &decoded);
        }
    }
}
