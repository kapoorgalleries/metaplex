#![allow(warnings)]

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::borsh::try_from_slice_unchecked;
use solana_program_test::*;
use solana_sdk::program_pack::Pack;
use solana_sdk::{
    account::Account,
    hash::Hash,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction, system_program,
    transaction::Transaction,
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

/// Initialize an auction with a random resource, and generate bidders with tokens that can be used
/// for testing.
async fn setup_auction(
    start: bool,
    max_winners: usize,
    price_floor: PriceFloor,
) -> (
    Pubkey,
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

    // Start executing test.
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

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
        // Bidder SPL Account, with Minted Tokens
        let bidder = Keypair::new();
        // PDA in the auction for the Bidder to deposit their funds to.
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

        // Owner via pot PDA.
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
    ];

    // Run each strategy with a new auction.
    for strategy in strategies.iter() {
        let (
            program_id,
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
        // Those are the accessors the auction program exposes as its stable interface, and the
        // ones metaplex actually redeems through -- see metaplex/test/src/redeem_bid.rs:41-45,
        // "Auction specifically does not expose internal state workings as it may change someday,
        // but it does expose a point get-winner-at-index method". Reading `bids` positionally is
        // what made this assertion wrong twice over: winners are the LAST `max` entries, and the
        // array now also retains losing bids (max_array_size_for, processor.rs:247).
        match auction.bid_state {
            BidState::EnglishAuction { ref bids, .. } => {
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
                    // the wallet. bidder.1/bidder.2 are the pot token account and pot PDA.
                    assert_eq!(auction.winner_at(rank), Some(bidder.0.pubkey()));
                    assert_eq!(auction.bid_state.amount(rank), *amount);
                    assert_eq!(auction.is_winner(&bidder.0.pubkey()), Some(rank));
                }

                // Any bid retained beyond the winner set must rank below every winner. This is
                // the property the retention buffer is for; nothing asserted it before.
                if let Some((_, lowest_winner)) = strategy.expect.first() {
                    for rank in strategy.expect.len()..bids.len() {
                        assert!(auction.bid_state.amount(rank) <= *lowest_winner);
                    }
                }

                // If the auction has ended, attempt to claim back SPL tokens into a new account.
                if auction.ended(0).unwrap() {
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

                    // Total claimed balance should match what we expect
                    let balance =
                        helpers::get_token_balance(&mut banks_client, &collection.pubkey()).await;
                    assert_eq!(balance, strategy.seller_collects);
                }
            }
            _ => {}
        }
    }
}

// Function wrapper expected to fail for testing failures.
async fn handle_failing_action(
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
            .await?;

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
            )?;

            assert!(auction.ended_at.is_some());
        }
    }

    Ok(())
}

#[cfg(feature = "test-bpf")]
#[tokio::test]
async fn test_incorrect_runs() {
    // Local wrapper around a small test description described by actions.
    #[derive(Debug)]
    struct Test {
        actions: Vec<Action>,
        max_winners: usize,
        price_floor: PriceFloor,
    }

    // A list of auction runs that should succeed. At the end of the run the winning bid state
    // should match the expected result.
    let strategies = [
        // Cancelling a bid that was never placed should fail (IncorrectOwner).
        Test {
            actions: vec![Action::Cancel(0), Action::End],
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
        },
        // Bidding again without cancelling the previous bid should fail (BidAlreadyActive).
        //
        // This case used to be commented "Bidding less than the top bidder should fail" and ran a
        // nine-action strategy. That intent is not something the program enforces -- a below-top
        // bid is a valid lower-ranked bid, see the strategy below -- and the strategy passed only
        // because its later repeat bids happened to trip BidAlreadyActive. It was green while
        // testing nothing it claimed. Reduced to the rule that actually fired, stated honestly.
        Test {
            actions: vec![
                Action::Bid(0, 5000),
                Action::Bid(1, 6000),
                Action::Bid(0, 7000),
                Action::End,
            ],
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
        },
        // Bidding below the auction's reserve price should fail (BidTooSmall).
        //
        // The original comment here was "Bidding less than any bidder should fail", with no price
        // floor set. The program has no such rule and by design cannot: BidState::place_bid does a
        // ranked insert, and its "Inserting at 0", mid-array and equal-amount branches
        // (processor.rs:259-314) are unreachable for every possible input unless below-top bids
        // are accepted. place_bid.rs:5-11 names small-bid spam as a considered attack and answers
        // it by PRUNING (bids.remove(0)), not by rejection.
        //
        // The program's actual amount rule is the price floor, applied both at bid time
        // (place_bid.rs:231-241 -> BidTooSmall) and at settlement, where is_winner/num_winners/
        // winner_at all inject it as `minimum` (processor.rs:155-177). So set one: at a floor of
        // 5000 the 5000 and 6000 bids stand and the 1000 bid is rejected. Note the boundary is
        // `amount < min` since 377f6cd, so a bid exactly at the floor is accepted.
        Test {
            actions: vec![
                Action::Bid(0, 5000),
                Action::Bid(1, 6000),
                Action::Bid(2, 1000),
                Action::End,
            ],
            max_winners: 3,
            price_floor: PriceFloor::MinimumPrice([5000, 0, 0, 0]),
        },
        // Bidding after an auction has been explicitly ended should fail (InvalidState).
        Test {
            actions: vec![Action::Bid(0, 5000), Action::End, Action::Bid(1, 6000)],
            max_winners: 3,
            price_floor: PriceFloor::None([0; 32]),
        },
    ];

    // Run each strategy with a new auction.
    for strategy in strategies.iter() {
        let (
            program_id,
            mut banks_client,
            bidders,
            payer,
            resource,
            mint,
            mint_authority,
            auction_pubkey,
            recent_blockhash,
        ) = setup_auction(true, strategy.max_winners, strategy.price_floor.clone()).await;

        let mut failed = false;

        for action in strategy.actions.iter() {
            failed = failed
                || handle_failing_action(
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
                .is_err();
        }

        // Expect to fail.
        assert!(failed);
    }
}
