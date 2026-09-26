#![allow(warnings)]

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::borsh::try_from_slice_unchecked;
use solana_program_test::*;
use solana_sdk::program_pack::Pack;
use solana_sdk::{
    account::Account,
    hash::Hash,
    instruction::{AccountMeta, Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction, system_program,
    transaction::{Transaction, TransactionError},
    transport::TransportError,
};
use spl_auction::{
    instruction,
    processor::{
        process_instruction, AuctionData, AuctionState, Bid, BidState, BidderPot, CancelBidArgs,
        CreateAuctionArgs, PlaceBidArgs, PriceFloor, StartAuctionArgs, WinnerLimit,
    },
    PREFIX,
};
use std::mem;

mod helpers;

// The program's error enum. Its module is private to the crate, so it is compiled into this test
// from the same source file instead of being copied here as numeric codes that could drift.
#[path = "../src/errors.rs"]
mod errors;
use errors::AuctionError;

/// Asserts that `result` is the auction program rejecting the transaction's only instruction with
/// `expected`. Every helper that sends an auction instruction sends it alone, at index 0.
fn assert_auction_error(result: Result<(), TransportError>, expected: AuctionError, what: &str) {
    let code = expected.clone() as u32;
    match result {
        Err(TransportError::TransactionError(TransactionError::InstructionError(
            0,
            InstructionError::Custom(actual),
        ))) if actual == code => {}
        other => panic!(
            "{}: expected {:?} (Custom({})), got {:?}",
            what, expected, code, other
        ),
    }
}

/// Initialize an auction with a random resource, and generate bidders with tokens that can be used
/// for testing.
async fn setup_auction(
    start: bool,
    max_winners: usize,
    price_floor: PriceFloor,
) -> (
    Pubkey,
    ProgramTestContext,
    BanksClient,
    Vec<(Keypair, Keypair, Pubkey)>,
    Keypair,
    Pubkey,
    Pubkey,
    Pubkey,
    Pubkey,
    Hash,
) {
    // Create a program to attach accounts to.
    let program_id = Pubkey::new_unique();
    let mut program_test =
        ProgramTest::new("spl_auction", program_id, processor!(process_instruction));

    // Start executing test. With a context rather than plain start(): only the context can warp
    // the bank ahead, and settlement needs the clock to move -- see test_correct_runs.
    let context = program_test.start_with_context().await;
    let mut banks_client = context.banks_client.clone();
    let payer = Keypair::from_bytes(&context.payer.to_bytes()).unwrap();
    let recent_blockhash = context.last_blockhash;

    // Create a Token mint to mint some test tokens with.
    let (mint_keypair, mint_manager) =
        helpers::create_mint(&mut banks_client, &payer, &recent_blockhash)
            .await
            .unwrap();

    // Derive Auction PDA account for lookup.
    let resource = Pubkey::new_unique();
    let seeds = &[PREFIX.as_bytes(), &program_id.as_ref(), resource.as_ref()];
    let (auction_pubkey, _) = Pubkey::find_program_address(seeds, &program_id);

    // Run Create Auction instruction.
    let err = helpers::create_auction(
        &mut banks_client,
        &program_id,
        &payer,
        &recent_blockhash,
        &resource,
        &mint_keypair.pubkey(),
        max_winners,
        price_floor,
    )
    .await
    .unwrap();

    // Attach useful Accounts for testing.
    let mut bidders = vec![];
    for n in 0..5 {
        // Bidder SPL Account, with Minted Tokens. The same keypair is also the bidder's signing
        // wallet (helpers::place_bid passes it as both), so these tests cannot tell the wallet
        // from the source token account apart.
        let bidder = Keypair::new();
        // SPL token account, owned by the auction, that escrows this bidder's funds (the pot
        // token account; place_bid.rs:202-204 checks the owner). A plain keypair, not a PDA.
        let auction_spl_pot = Keypair::new();

        // Generate User SPL Wallet Account
        helpers::create_token_account(
            &mut banks_client,
            &payer,
            &recent_blockhash,
            &bidder,
            &mint_keypair.pubkey(),
            &payer.pubkey(),
        )
        .await
        .unwrap();

        // BidderPot PDA: the state account that records which SPL account is this bidder's pot
        // (place_bid.rs:264-272). It owns nothing.
        let (bid_pot_pubkey, pot_bump) = Pubkey::find_program_address(
            &[
                PREFIX.as_bytes(),
                program_id.as_ref(),
                auction_pubkey.as_ref(),
                bidder.pubkey().as_ref(),
            ],
            &program_id,
        );

        // Generate Auction SPL Pot to Transfer to.
        helpers::create_token_account(
            &mut banks_client,
            &payer,
            &recent_blockhash,
            &auction_spl_pot,
            &mint_keypair.pubkey(),
            &auction_pubkey,
        )
        .await
        .unwrap();

        // Mint Tokens
        helpers::mint_tokens(
            &mut banks_client,
            &payer,
            &recent_blockhash,
            &mint_keypair.pubkey(),
            &bidder.pubkey(),
            &mint_manager,
            10_000_000,
        )
        .await
        .unwrap();

        bidders.push((bidder, auction_spl_pot, bid_pot_pubkey));
    }

    // Verify Auction was created as expected.
    let auction: AuctionData = try_from_slice_unchecked(
        &banks_client
            .get_account(auction_pubkey)
            .await
            .expect("get_account")
            .expect("account not found")
            .data,
    )
    .unwrap();

    assert_eq!(auction.authority, payer.pubkey());
    assert_eq!(auction.last_bid, None);
    assert_eq!(auction.state as i32, AuctionState::create() as i32);
    assert_eq!(auction.end_auction_at, None);
    // WinnerLimit::Capped must produce an English auction. test_correct_runs checks winners and
    // settles only through the EnglishAuction variant, so a different variant has to fail here.
    assert_eq!(auction.bid_state, BidState::new_english(max_winners));

    // Start Auction.
    if start {
        helpers::start_auction(
            &mut banks_client,
            &program_id,
            &recent_blockhash,
            &payer,
            &resource,
        )
        .await
        .unwrap();
    }

    return (
        program_id,
        context,
        banks_client,
        bidders,
        payer,
        resource,
        mint_keypair.pubkey(),
        mint_manager.pubkey(),
        auction_pubkey,
        recent_blockhash,
    );
}

/// Used to drive tests in the functions below.
#[derive(Debug)]
enum Action {
    Bid(usize, u64),
    Cancel(usize),
    End,
}
#[cfg(feature = "test-bpf")]
#[tokio::test]
async fn test_correct_runs() {
    // Local wrapper around a small test description described by actions.
    struct Test {
        actions: Vec<Action>,
        expect: Vec<(usize, u64)>,
        max_winners: usize,
        price_floor: PriceFloor,
        seller_collects: u64,
    }

    // A list of auction runs that should succeed. At the end of the run the winning bid state
    // should match the expected result.
    let strategies = [
        // Simple successive bids should work.
        Test {
            actions: vec![
                Action::Bid(0, 1000),
                Action::Bid(1, 2000),
                Action::Bid(2, 3000),
                Action::Bid(3, 4000),
                Action::End,
            ],
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
            seller_collects: 9000,
            expect: vec![(1, 2000), (2, 3000), (3, 4000)],
        },
        // A single bidder should be able to cancel and rebid lower.
        Test {
            actions: vec![
                Action::Bid(0, 5000),
                Action::Cancel(0),
                Action::Bid(0, 4000),
                Action::End,
            ],
            expect: vec![(0, 4000)],
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
            seller_collects: 4000,
        },
        // The top bidder when cancelling should allow room for lower bidders.
        Test {
            actions: vec![
                Action::Bid(0, 5000),
                Action::Bid(1, 6000),
                Action::Cancel(1),
                Action::Bid(2, 5500),
                Action::Bid(1, 6000),
                Action::Bid(3, 7000),
                Action::Cancel(0),
                Action::End,
            ],
            expect: vec![(2, 5500), (1, 6000), (3, 7000)],
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
            seller_collects: 18500,
        },
        // An auction where everyone cancels should still succeed, with no winners.
        Test {
            actions: vec![
                Action::Bid(0, 5000),
                Action::Bid(1, 6000),
                Action::Bid(2, 7000),
                Action::Cancel(0),
                Action::Cancel(1),
                Action::Cancel(2),
                Action::End,
            ],
            expect: vec![],
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
            seller_collects: 0,
        },
        // An auction where no one bids should still succeed.
        Test {
            actions: vec![Action::End],
            expect: vec![],
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
            seller_collects: 0,
        },
        // Bids below the current top are accepted and ranked; ties go to the earlier bid.
        //
        // No strategy above ever inserts anywhere but the end of `bids`. This one takes every
        // branch of BidState::place_bid (processor.rs:259-314): insert at 0 (2000, then 1000),
        // mid-array (3000 below 4000), and equal-amount (bidder 3's 3000 ranks below bidder 2's
        // earlier 3000). A "must beat the top bid" rule would reject the second bid; a
        // push-only insert would rank 1000 above 4000.
        Test {
            actions: vec![
                Action::Bid(0, 4000),
                Action::Bid(1, 2000),
                Action::Bid(2, 3000),
                Action::Bid(3, 3000),
                Action::Bid(4, 1000),
                Action::End,
            ],
            expect: vec![(3, 3000), (2, 3000), (0, 4000)],
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
            seller_collects: 10000,
        },
        // A winner cancelling promotes the best retained losing bid into the winner set.
        //
        // This is what the retention buffer (max_array_size_for, processor.rs:247) is for. If
        // `bids` kept only `max_winners` entries, bidder 3's bid would have evicted bidder 0's,
        // and after the cancel there would be two winners instead of three.
        Test {
            actions: vec![
                Action::Bid(0, 1000),
                Action::Bid(1, 2000),
                Action::Bid(2, 3000),
                Action::Bid(3, 4000),
                Action::Cancel(3),
                Action::End,
            ],
            expect: vec![(0, 1000), (1, 2000), (2, 3000)],
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
            seller_collects: 6000,
        },
        // A bid exactly at the reserve price is accepted, and wins.
        //
        // place_bid.rs:238 rejects `amount < min` since 377f6cd (it was `<=`). This pins that
        // boundary from the accepting side; test_incorrect_runs pins the rejecting side.
        Test {
            actions: vec![Action::Bid(0, 5000), Action::Bid(1, 6000), Action::End],
            expect: vec![(0, 5000), (1, 6000)],
            max_winners: 3,
            price_floor: PriceFloor::MinimumPrice([5000, 0, 0, 0]),
            seller_collects: 11000,
        },
    ];

    // Run each strategy with a new auction.
    for strategy in strategies.iter() {
        let (
            program_id,
            mut context,
            mut banks_client,
            bidders,
            payer,
            resource,
            mint,
            mint_authority,
            auction_pubkey,
            recent_blockhash,
        ) = setup_auction(true, strategy.max_winners, strategy.price_floor.clone()).await;

        // Interpret test actions one by one.
        for action in strategy.actions.iter() {
            println!("Strategy: {} Step {:?}", strategy.actions.len(), action);
            match *action {
                Action::Bid(bidder, amount) => {
                    // Get balances pre bidding.
                    let pre_balance = (
                        helpers::get_token_balance(&mut banks_client, &bidders[bidder].0.pubkey())
                            .await,
                        helpers::get_token_balance(&mut banks_client, &bidders[bidder].1.pubkey())
                            .await,
                    );

                    let transfer_authority = Keypair::new();
                    helpers::approve(
                        &mut banks_client,
                        &recent_blockhash,
                        &payer,
                        &transfer_authority.pubkey(),
                        &bidders[bidder].0,
                        amount,
                    )
                    .await
                    .expect("approve");

                    helpers::place_bid(
                        &mut banks_client,
                        &recent_blockhash,
                        &program_id,
                        &payer,
                        &bidders[bidder].0,
                        &bidders[bidder].1,
                        &transfer_authority,
                        &resource,
                        &mint,
                        amount,
                    )
                    .await
                    .expect("place_bid");

                    let post_balance = (
                        helpers::get_token_balance(&mut banks_client, &bidders[bidder].0.pubkey())
                            .await,
                        helpers::get_token_balance(&mut banks_client, &bidders[bidder].1.pubkey())
                            .await,
                    );

                    assert_eq!(post_balance.0, pre_balance.0 - amount);
                    assert_eq!(post_balance.1, pre_balance.1 + amount);
                }

                Action::Cancel(bidder) => {
                    // Get balances pre bidding.
                    let pre_balance = (
                        helpers::get_token_balance(&mut banks_client, &bidders[bidder].0.pubkey())
                            .await,
                        helpers::get_token_balance(&mut banks_client, &bidders[bidder].1.pubkey())
                            .await,
                    );

                    helpers::cancel_bid(
                        &mut banks_client,
                        &recent_blockhash,
                        &program_id,
                        &payer,
                        &bidders[bidder].0,
                        &bidders[bidder].1,
                        &resource,
                        &mint,
                    )
                    .await
                    .expect("cancel_bid");

                    let bidder_account = banks_client
                        .get_account(bidders[bidder].0.pubkey())
                        .await
                        .expect("get_account")
                        .expect("account not found");

                    let post_balance = (
                        helpers::get_token_balance(&mut banks_client, &bidders[bidder].0.pubkey())
                            .await,
                        helpers::get_token_balance(&mut banks_client, &bidders[bidder].1.pubkey())
                            .await,
                    );

                    // Assert the balance successfully moves.
                    assert_eq!(post_balance.0, pre_balance.0 + pre_balance.1);
                    assert_eq!(post_balance.1, 0);
                }

                Action::End => {
                    helpers::end_auction(
                        &mut banks_client,
                        &program_id,
                        &recent_blockhash,
                        &payer,
                        &resource,
                    )
                    .await
                    .expect("end_auction");

                    // Assert Auction is actually in ended state.
                    let auction: AuctionData = try_from_slice_unchecked(
                        &banks_client
                            .get_account(auction_pubkey)
                            .await
                            .expect("get_account")
                            .expect("account not found")
                            .data,
                    )
                    .unwrap();

                    assert!(auction.ended_at.is_some());
                    assert_eq!(auction.state, AuctionState::Ended);
                }
            }
        }

        // Verify a bid was created, and Metadata for this bidder correctly reflects
        // the last bid as expected.
        let auction: AuctionData = try_from_slice_unchecked(
            &banks_client
                .get_account(auction_pubkey)
                .await
                .expect("get_account")
                .expect("account not found")
                .data,
        )
        .unwrap();

        // Verify BidState, all winners should be as expected.
        //
        // Asserted through num_winners/winner_at/amount rather than by walking `bids` directly.
        // These are the accessors metaplex settles through: winner_at, per the note at
        // metaplex/program/src/processor/redeem_bid.rs:40-44 ("Auction specifically does not
        // expose internal state workings as it may change someday, but it does expose a point
        // get-winner-at-index method"), and num_winners and amount in
        // empty_payment_account.rs. Reading `bids` positionally is what made this assertion
        // wrong twice over: winners are the LAST `max` entries, and the array now also retains
        // losing bids (max_array_size_for, processor.rs:247).
        match auction.bid_state {
            BidState::EnglishAuction { ref bids, ref max } => {
                assert_eq!(*max, strategy.max_winners);

                // The winner set is exactly the size expected -- no extras. The old zip() could
                // not catch an extra winner, because zip stops at the shorter side.
                assert_eq!(auction.num_winners(), strategy.expect.len() as u64);

                // `expect` lists winners in ascending amount; winner_at(0) is the top bid
                // (processor.rs:383-397 indexes from the end), so walk `expect` in reverse.
                for (rank, (index, amount)) in strategy.expect.iter().rev().enumerate() {
                    let bidder = &bidders[*index];

                    // Bid identity is the bidder's own signing wallet, not either pot key.
                    // place_bid.rs:321 records Bid(*accounts.bidder.key, ..) with the bidder
                    // asserted as signer at place_bid.rs:112, and metaplex's common_redeem_checks
                    // (metaplex/program/src/utils.rs:393 and :476-484) passes one key to both
                    // is_winner() and the bidder_metadata derivation -- which only type-checks as
                    // the wallet. bidder.1/bidder.2 are the pot token account and pot PDA. (The
                    // fixture reuses the wallet as the source token account -- see setup_auction
                    // -- so this rules out the pot keys, not bidder_token.)
                    assert_eq!(auction.winner_at(rank), Some(bidder.0.pubkey()));
                    assert_eq!(auction.bid_state.amount(rank), *amount);
                    assert_eq!(auction.is_winner(&bidder.0.pubkey()), Some(rank));
                }

                // Everyone outside the expected winner set lost: no rank, and no winner past the
                // last expected one.
                for (index, bidder) in bidders.iter().enumerate() {
                    if strategy.expect.iter().all(|(winner, _)| *winner != index) {
                        assert_eq!(auction.is_winner(&bidder.0.pubkey()), None);
                    }
                }
                assert_eq!(auction.winner_at(strategy.expect.len()), None);

                // Any bid retained beyond the winner set must rank at or below every winner.
                // Strategies 1 and 6 end with retained losing bids.
                if let Some((_, lowest_winner)) = strategy.expect.first() {
                    for rank in strategy.expect.len()..bids.len() {
                        assert!(auction.bid_state.amount(rank) <= *lowest_winner);
                    }
                }

                // The live losing bids: `bids` is ascending and the winners are its last entries.
                let losers: Vec<usize> = bids[..bids.len() - strategy.expect.len()]
                    .iter()
                    .map(|bid| {
                        bidders
                            .iter()
                            .position(|bidder| bidder.0.pubkey() == bid.0)
                            .expect("every bid belongs to a test bidder")
                    })
                    .collect();

                // Settle: claim every winning bid into a fresh account and check what the seller
                // collects. Every strategy above ends with Action::End, so this always runs; a bid
                // state other than EnglishAuction fails the match below.
                //
                // It used to be gated on `auction.ended(0)`. With the end/gap pair this program
                // records after end_auction -- (Some(ended_at), None) -- that is `0 > ended_at`
                // (processor.rs:148), false for any real clock, so no claim ever ran and
                // seller_collects was never checked. The assert makes a strategy that forgets
                // to end its auction fail here instead of skipping settlement silently.
                assert!(
                    auction.ended_at.is_some(),
                    "strategy must end the auction before settlement"
                );

                // claim_bid requires the clock to be strictly past ended_at (claim_bid.rs:129 via
                // processor.rs:148). program-test 1.6's start() never leaves slot 1 -- its
                // background task only registers ticks on one bank -- so the clock stays at the
                // second end_auction recorded and every claim fails with InvalidState. Warp ahead;
                // then check the clock moved rather than assume it did.
                let slot = banks_client.get_root_slot().await.unwrap();
                context.warp_to_slot(slot + 1000).unwrap();
                let recent_blockhash = context.last_blockhash;
                let now = helpers::get_clock(&mut banks_client).await.unix_timestamp;
                assert!(
                    now > auction.ended_at.unwrap(),
                    "warp did not move the clock past ended_at"
                );

                // Once the auction has ended, a winner can no longer withdraw: cancel_bid must
                // refuse with InvalidState and leave the pot untouched (cancel_bid.rs:177-180).
                //
                // That guard is ended(now) -- time, not AuctionState::Ended -- so it only holds
                // once the clock has passed ended_at, which is why this runs after the warp. In
                // the same second end_auction ran (and, with an end_auction_gap, until
                // last_bid + gap), a winner's cancel still succeeds and is refunded. That is
                // program behaviour, outside what these tests change; it is not asserted here.
                for (index, _amount) in strategy.expect.iter() {
                    let pot = &bidders[*index].1.pubkey();
                    let escrowed = helpers::get_token_balance(&mut banks_client, pot).await;
                    assert_auction_error(
                        helpers::cancel_bid(
                            &mut banks_client,
                            &recent_blockhash,
                            &program_id,
                            &payer,
                            &bidders[*index].0,
                            &bidders[*index].1,
                            &resource,
                            &mint,
                        )
                        .await,
                        AuctionError::InvalidState,
                        "a winner cancelling after the end",
                    );
                    assert_eq!(
                        helpers::get_token_balance(&mut banks_client, pot).await,
                        escrowed
                    );
                }

                let collection = Keypair::new();

                // Generate Collection Pot.
                helpers::create_token_account(
                    &mut banks_client,
                    &payer,
                    &recent_blockhash,
                    &collection,
                    &mint,
                    &payer.pubkey(),
                )
                .await
                .unwrap();

                // For each winning bid, claim into auction.
                for (index, _amount) in strategy.expect.iter() {
                    let err = helpers::claim_bid(
                        &mut banks_client,
                        &recent_blockhash,
                        &program_id,
                        &payer,
                        &payer,
                        &bidders[*index].0,
                        &bidders[*index].1,
                        &collection.pubkey(),
                        &resource,
                        &mint,
                    )
                    .await;
                    println!("{:?}", err);
                    err.expect("claim_bid");

                    // Bid pot should be empty
                    let balance =
                        helpers::get_token_balance(&mut banks_client, &bidders[*index].1.pubkey())
                            .await;
                    assert_eq!(balance, 0);
                }

                // A losing bid cannot be claimed: claim_bid refuses with InvalidState before it
                // moves anything (claim_bid.rs:123-126), and the loser's escrow stays put.
                for index in losers.iter() {
                    let pot = &bidders[*index].1.pubkey();
                    let escrowed = helpers::get_token_balance(&mut banks_client, pot).await;
                    assert_auction_error(
                        helpers::claim_bid(
                            &mut banks_client,
                            &recent_blockhash,
                            &program_id,
                            &payer,
                            &payer,
                            &bidders[*index].0,
                            &bidders[*index].1,
                            &collection.pubkey(),
                            &resource,
                            &mint,
                        )
                        .await,
                        AuctionError::InvalidState,
                        "claiming a losing bid",
                    );
                    assert_eq!(
                        helpers::get_token_balance(&mut banks_client, pot).await,
                        escrowed
                    );
                }

                // Total claimed balance should match what we expect
                let balance =
                    helpers::get_token_balance(&mut banks_client, &collection.pubkey()).await;
                assert_eq!(balance, strategy.seller_collects);
            }
            ref other => panic!(
                "WinnerLimit::Capped({}) must produce an EnglishAuction, got {:?}",
                strategy.max_winners, other
            ),
        }
    }
}

/// Runs one action for test_incorrect_runs and returns the auction instruction's result.
///
/// Only the auction instruction's own result is returned. The approve transaction a bid needs, and
/// reading the auction back after an End, must succeed, so neither can stand in for the rejection a
/// strategy expects.
async fn try_action(
    banks_client: &mut BanksClient,
    recent_blockhash: &Hash,
    program_id: &Pubkey,
    bidders: &Vec<(Keypair, Keypair, Pubkey)>,
    mint: &Pubkey,
    payer: &Keypair,
    resource: &Pubkey,
    auction_pubkey: &Pubkey,
    action: &Action,
) -> Result<(), TransportError> {
    match *action {
        Action::Bid(bidder, amount) => {
            // Get balances pre bidding.
            let pre_balance = (
                helpers::get_token_balance(banks_client, &bidders[bidder].0.pubkey()).await,
                helpers::get_token_balance(banks_client, &bidders[bidder].1.pubkey()).await,
            );

            let transfer_authority = Keypair::new();
            helpers::approve(
                banks_client,
                &recent_blockhash,
                &payer,
                &transfer_authority.pubkey(),
                &bidders[bidder].0,
                amount,
            )
            .await
            .expect("approve");

            let value = helpers::place_bid(
                banks_client,
                &recent_blockhash,
                &program_id,
                &payer,
                &bidders[bidder].0,
                &bidders[bidder].1,
                &transfer_authority,
                &resource,
                &mint,
                amount,
            )
            .await?;

            let post_balance = (
                helpers::get_token_balance(banks_client, &bidders[bidder].0.pubkey()).await,
                helpers::get_token_balance(banks_client, &bidders[bidder].1.pubkey()).await,
            );

            assert_eq!(post_balance.0, pre_balance.0 - amount);
            assert_eq!(post_balance.1, pre_balance.1 + amount);
        }

        Action::Cancel(bidder) => {
            // Get balances pre bidding.
            let pre_balance = (
                helpers::get_token_balance(banks_client, &bidders[bidder].0.pubkey()).await,
                helpers::get_token_balance(banks_client, &bidders[bidder].1.pubkey()).await,
            );

            helpers::cancel_bid(
                banks_client,
                &recent_blockhash,
                &program_id,
                &payer,
                &bidders[bidder].0,
                &bidders[bidder].1,
                &resource,
                &mint,
            )
            .await?;

            let bidder_account = banks_client
                .get_account(bidders[bidder].0.pubkey())
                .await
                .expect("get_account")
                .expect("account not found");

            let post_balance = (
                helpers::get_token_balance(banks_client, &bidders[bidder].0.pubkey()).await,
                helpers::get_token_balance(banks_client, &bidders[bidder].1.pubkey()).await,
            );

            // Assert the balance successfully moves.
            assert_eq!(post_balance.0, pre_balance.0 + pre_balance.1);
            assert_eq!(post_balance.1, 0);
        }

        Action::End => {
            helpers::end_auction(
                banks_client,
                &program_id,
                &recent_blockhash,
                &payer,
                &resource,
            )
            .await?;

            // Assert Auction is actually in ended state.
            let auction: AuctionData = try_from_slice_unchecked(
                &banks_client
                    .get_account(*auction_pubkey)
                    .await
                    .expect("get_account")
                    .expect("account not found")
                    .data,
            )
            .unwrap();

            assert!(auction.ended_at.is_some());
            assert_eq!(auction.state, AuctionState::Ended);
        }
    }

    Ok(())
}

#[cfg(feature = "test-bpf")]
#[tokio::test]
async fn test_incorrect_runs() {
    // An auction run that must be rejected: every `setup` action has to succeed, and then
    // `rejected` has to fail with `error` and move no funds.
    //
    // This used to record only whether any action failed, and stopped at the first failure, so a
    // setup action failing for an unrelated reason passed as the expected rejection. Reverting
    // 377f6cd, for one, makes the at-floor 5000 bid in the reserve-price case fail, and the test
    // stayed green without ever placing the below-floor bid.
    #[derive(Debug)]
    struct Test {
        setup: Vec<Action>,
        rejected: Action,
        error: AuctionError,
        max_winners: usize,
        price_floor: PriceFloor,
    }

    let strategies = [
        // Cancelling a bid that was never placed: the bidder's metadata account does not exist,
        // so it is not owned by the program (cancel_bid.rs:79).
        Test {
            setup: vec![],
            rejected: Action::Cancel(0),
            error: AuctionError::IncorrectOwner,
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
        },
        // Bidding again without cancelling the previous bid (place_bid.rs:183-185).
        //
        // This case used to be commented "Bidding less than the top bidder should fail" and ran a
        // nine-action strategy. The program does not enforce that -- a below-top bid is a valid
        // lower-ranked bid, see the ranked-insert strategy in test_correct_runs -- and the
        // strategy passed only because its later repeat bids happened to trip BidAlreadyActive.
        // It was green while testing nothing it claimed. Reduced to the rule that actually fired.
        Test {
            setup: vec![Action::Bid(0, 5000), Action::Bid(1, 6000)],
            rejected: Action::Bid(0, 7000),
            error: AuctionError::BidAlreadyActive,
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
        },
        // Bidding below the auction's reserve price (place_bid.rs:231-241).
        //
        // The original comment here was "Bidding less than any bidder should fail", with no price
        // floor set. The program has no such rule: BidState::place_bid does a ranked insert that
        // accepts a new lowest bid (the "Inserting at 0" branch, processor.rs:259-314), and when
        // the array is full it evicts the lowest bid (processor.rs:299-301) rather than refusing
        // one. The amount rule it does have is the price floor, applied at bid time and again at
        // settlement, where is_winner/num_winners/winner_at inject it as `minimum`
        // (processor.rs:155-177). So set one: at a floor of 5000 the 5000 and 6000 bids must be
        // accepted and the 1000 bid rejected. The boundary is `amount < min` since 377f6cd, so a
        // bid exactly at the floor is accepted.
        Test {
            setup: vec![Action::Bid(0, 5000), Action::Bid(1, 6000)],
            rejected: Action::Bid(2, 1000),
            error: AuctionError::BidTooSmall,
            max_winners: 3,
            price_floor: PriceFloor::MinimumPrice([5000, 0, 0, 0]),
        },
        // Bidding after the auction has been explicitly ended (place_bid.rs:227-229).
        Test {
            setup: vec![Action::Bid(0, 5000), Action::End],
            rejected: Action::Bid(1, 6000),
            error: AuctionError::InvalidState,
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
        },
    ];

    // Run each strategy with a new auction.
    for strategy in strategies.iter() {
        let (
            program_id,
            _context,
            mut banks_client,
            bidders,
            payer,
            resource,
            mint,
            mint_authority,
            auction_pubkey,
            recent_blockhash,
        ) = setup_auction(true, strategy.max_winners, strategy.price_floor.clone()).await;

        for action in strategy.setup.iter() {
            if let Err(err) = try_action(
                &mut banks_client,
                &recent_blockhash,
                &program_id,
                &bidders,
                &mint,
                &payer,
                &resource,
                &auction_pubkey,
                action,
            )
            .await
            {
                panic!(
                    "{:?}: setup action {:?} must succeed, got {:?}",
                    strategy.error, action, err
                );
            }
        }

        // The rejected action's bidder: its wallet and pot must not change.
        let bidder = match strategy.rejected {
            Action::Bid(bidder, _) | Action::Cancel(bidder) => &bidders[bidder],
            Action::End => panic!("no strategy expects End to be rejected"),
        };
        let balances_before = (
            helpers::get_token_balance(&mut banks_client, &bidder.0.pubkey()).await,
            helpers::get_token_balance(&mut banks_client, &bidder.1.pubkey()).await,
        );

        assert_auction_error(
            try_action(
                &mut banks_client,
                &recent_blockhash,
                &program_id,
                &bidders,
                &mint,
                &payer,
                &resource,
                &auction_pubkey,
                &strategy.rejected,
            )
            .await,
            strategy.error.clone(),
            &format!("{:?}", strategy.rejected),
        );

        let balances_after = (
            helpers::get_token_balance(&mut banks_client, &bidder.0.pubkey()).await,
            helpers::get_token_balance(&mut banks_client, &bidder.1.pubkey()).await,
        );
        assert_eq!(balances_after, balances_before);
    }
}
