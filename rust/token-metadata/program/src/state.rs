use {
    crate::{error::MetadataError, utils::try_from_slice_checked},
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{
        account_info::AccountInfo, entrypoint::ProgramResult, program_error::ProgramError,
        pubkey::Pubkey,
    },
};
/// prefix used for PDAs to avoid certain collision attacks (https://en.wikipedia.org/wiki/Collision_attack#Chosen-prefix_collision_attack)
pub const PREFIX: &str = "metadata";

/// Used in seeds to make Edition model pda address
pub const EDITION: &str = "edition";

pub const RESERVATION: &str = "reservation";

pub const MAX_NAME_LENGTH: usize = 32;

pub const MAX_SYMBOL_LENGTH: usize = 10;

pub const MAX_URI_LENGTH: usize = 200;

pub const MAX_METADATA_LEN: usize = 1
    + 32
    + 32
    + MAX_NAME_LENGTH
    + MAX_SYMBOL_LENGTH
    + MAX_URI_LENGTH
    + MAX_CREATOR_LIMIT * MAX_CREATOR_LEN
    + 2
    + 1
    + 1
    + 198;

pub const MAX_EDITION_LEN: usize = 1 + 32 + 8 + 200;

pub const MAX_MASTER_EDITION_LEN: usize = 1 + 9 + 8 + 32 + 32 + 200;

pub const MAX_CREATOR_LIMIT: usize = 5;

pub const MAX_CREATOR_LEN: usize = 32 + 1 + 1;

pub const MAX_RESERVATIONS: usize = 200;

// can hold up to 200 keys per reservation, note: the extra 8 is for number of elements in the vec
pub const MAX_RESERVATION_LIST_V1_SIZE: usize = 1 + 32 + 8 + 8 + MAX_RESERVATIONS * 34 + 100;

// can hold up to 200 keys per reservation, note: the extra 8 is for number of elements in the vec
pub const MAX_RESERVATION_LIST_SIZE: usize = 1 + 32 + 8 + 8 + MAX_RESERVATIONS * 48 + 100;

#[repr(C)]
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub enum Key {
    Uninitialized,
    EditionV1,
    MasterEditionV1,
    ReservationListV1,
    MetadataV1,
    ReservationListV2,
}
#[repr(C)]
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub struct Data {
    /// The name of the asset
    pub name: String,
    /// The symbol for the asset
    pub symbol: String,
    /// URI pointing to JSON representing the asset
    pub uri: String,
    /// Royalty basis points that goes to creators in secondary sales (0-10000)
    pub seller_fee_basis_points: u16,
    /// Array of creators, optional
    pub creators: Option<Vec<Creator>>,
}

#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, Debug)]
pub struct Metadata {
    pub key: Key,
    pub update_authority: Pubkey,
    pub mint: Pubkey,
    pub data: Data,
    // Immutable, once flipped, all sales of this metadata are considered secondary.
    pub primary_sale_happened: bool,
    // Whether or not the data struct is mutable, default is not
    pub is_mutable: bool,
}

impl Metadata {
    pub fn from_account_info(a: &AccountInfo) -> Result<Metadata, ProgramError> {
        let md: Metadata =
            try_from_slice_checked(&a.data.borrow_mut(), Key::MetadataV1, MAX_METADATA_LEN)?;

        Ok(md)
    }
}

#[repr(C)]
#[derive(Clone, Debug, PartialEq, BorshSerialize, BorshDeserialize)]
pub struct MasterEdition {
    pub key: Key,

    pub supply: u64,

    pub max_supply: Option<u64>,

    /// Can be used to mint tokens that give one-time permission to mint a single limited edition.
    pub printing_mint: Pubkey,

    /// If you don't know how many printing tokens you are going to need, but you do know
    /// you are going to need some amount in the future, you can use a token from this mint.
    /// Coming back to token metadata with one of these tokens allows you to mint (one time)
    /// any number of printing tokens you want. This is used for instance by Auction Manager
    /// with participation NFTs, where we dont know how many people will bid and need participation
    /// printing tokens to redeem, so we give it ONE of these tokens to use after the auction is over,
    /// because when the auction begins we just dont know how many printing tokens we will need,
    /// but at the end we will. At the end it then burns this token with token-metadata to
    /// get the printing tokens it needs to give to bidders. Each bidder then redeems a printing token
    /// to get their limited editions.
    pub one_time_printing_authorization_mint: Pubkey,
}

impl MasterEdition {
    pub fn from_account_info(a: &AccountInfo) -> Result<MasterEdition, ProgramError> {
        let me: MasterEdition = try_from_slice_checked(
            &a.data.borrow_mut(),
            Key::MasterEditionV1,
            MAX_MASTER_EDITION_LEN,
        )?;

        Ok(me)
    }
}

#[repr(C)]
#[derive(Clone, Debug, PartialEq, BorshSerialize, BorshDeserialize)]
/// All Editions should never have a supply greater than 1.
/// To enforce this, a transfer mint authority instruction will happen when
/// a normal token is turned into an Edition, and in order for a Metadata update authority
/// to do this transaction they will also need to sign the transaction as the Mint authority.
pub struct Edition {
    pub key: Key,

    /// Points at MasterEdition struct
    pub parent: Pubkey,

    /// Starting at 0 for master record, this is incremented for each edition minted.
    pub edition: u64,
}

impl Edition {
    pub fn from_account_info(a: &AccountInfo) -> Result<Edition, ProgramError> {
        let ed: Edition =
            try_from_slice_checked(&a.data.borrow_mut(), Key::EditionV1, MAX_EDITION_LEN)?;

        Ok(ed)
    }
}

#[repr(C)]
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub struct Creator {
    pub address: Pubkey,
    pub verified: bool,
    // In percentages, NOT basis points ;) Watch out!
    pub share: u8,
}

pub trait ReservationList {
    fn master_edition(&self) -> Pubkey;
    fn supply_snapshot(&self) -> Option<u64>;
    fn reservations(&self) -> Vec<Reservation>;
    fn set_master_edition(&mut self, key: Pubkey);
    fn set_supply_snapshot(&mut self, supply: Option<u64>);
    fn set_reservations(&mut self, reservations: Vec<Reservation>);
    fn save(&self, account: &AccountInfo) -> ProgramResult;
}

pub fn get_reservation_list(
    account: &AccountInfo,
) -> Result<Box<dyn ReservationList>, ProgramError> {
    let version = account.data.borrow()[0];

    // For some reason when converting Key to u8 here, it becomes unreachable. Use direct constant instead.
    match version {
        3 => return Ok(Box::new(ReservationListV1::from_account_info(account)?)),
        5 => return Ok(Box::new(ReservationListV2::from_account_info(account)?)),
        _ => return Err(MetadataError::DataTypeMismatch.into()),
    };
}

#[repr(C)]
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub struct ReservationListV2 {
    pub key: Key,
    /// Present for reverse lookups
    pub master_edition: Pubkey,

    /// What supply counter was on master_edition when this reservation was created.
    pub supply_snapshot: Option<u64>,
    pub reservations: Vec<Reservation>,
}

impl ReservationList for ReservationListV2 {
    fn master_edition(&self) -> Pubkey {
        self.master_edition
    }

    fn supply_snapshot(&self) -> Option<u64> {
        self.supply_snapshot
    }

    fn reservations(&self) -> Vec<Reservation> {
        self.reservations.clone()
    }

    fn set_master_edition(&mut self, key: Pubkey) {
        self.master_edition = key
    }

    fn set_supply_snapshot(&mut self, supply: Option<u64>) {
        self.supply_snapshot = supply;
    }

    fn set_reservations(&mut self, reservations: Vec<Reservation>) {
        self.reservations = reservations
    }

    fn save(&self, account: &AccountInfo) -> ProgramResult {
        self.serialize(&mut *account.data.borrow_mut())?;
        Ok(())
    }
}

impl ReservationListV2 {
    pub fn from_account_info(a: &AccountInfo) -> Result<ReservationListV2, ProgramError> {
        let res: ReservationListV2 = try_from_slice_checked(
            &a.data.borrow_mut(),
            Key::ReservationListV2,
            MAX_RESERVATION_LIST_SIZE,
        )?;

        Ok(res)
    }
}

#[repr(C)]
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub struct Reservation {
    pub address: Pubkey,
    pub spots_remaining: u64,
    pub total_spots: u64,
}

// Legacy Reservation List with u8s
#[repr(C)]
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub struct ReservationListV1 {
    pub key: Key,
    /// Present for reverse lookups
    pub master_edition: Pubkey,

    /// What supply counter was on master_edition when this reservation was created.
    pub supply_snapshot: Option<u64>,
    pub reservations: Vec<ReservationV1>,
}

impl ReservationList for ReservationListV1 {
    fn master_edition(&self) -> Pubkey {
        self.master_edition
    }

    fn supply_snapshot(&self) -> Option<u64> {
        self.supply_snapshot
    }

    fn reservations(&self) -> Vec<Reservation> {
        self.reservations
            .iter()
            .map(|r| Reservation {
                address: r.address,
                spots_remaining: r.spots_remaining as u64,
                total_spots: r.total_spots as u64,
            })
            .collect()
    }

    fn set_master_edition(&mut self, key: Pubkey) {
        self.master_edition = key
    }

    fn set_supply_snapshot(&mut self, supply: Option<u64>) {
        self.supply_snapshot = supply;
    }

    fn set_reservations(&mut self, reservations: Vec<Reservation>) {
        self.reservations = reservations
            .iter()
            .map(|r| ReservationV1 {
                address: r.address,
                spots_remaining: r.spots_remaining as u8,
                total_spots: r.total_spots as u8,
            })
            .collect();
    }

    fn save(&self, account: &AccountInfo) -> ProgramResult {
        self.serialize(&mut *account.data.borrow_mut())?;
        Ok(())
    }
}

impl ReservationListV1 {
    pub fn from_account_info(a: &AccountInfo) -> Result<ReservationListV1, ProgramError> {
        let res: ReservationListV1 = try_from_slice_checked(
            &a.data.borrow_mut(),
            Key::ReservationListV1,
            MAX_RESERVATION_LIST_V1_SIZE,
        )?;

        Ok(res)
    }
}

#[repr(C)]
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub struct ReservationV1 {
    pub address: Pubkey,
    pub spots_remaining: u8,
    pub total_spots: u8,
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

    // ── Key enum ──

    #[test]
    fn key_enum_discriminants() {
        assert_eq!(Key::Uninitialized.try_to_vec().unwrap()[0], 0);
        assert_eq!(Key::EditionV1.try_to_vec().unwrap()[0], 1);
        assert_eq!(Key::MasterEditionV1.try_to_vec().unwrap()[0], 2);
        assert_eq!(Key::ReservationListV1.try_to_vec().unwrap()[0], 3);
        assert_eq!(Key::MetadataV1.try_to_vec().unwrap()[0], 4);
        assert_eq!(Key::ReservationListV2.try_to_vec().unwrap()[0], 5);
    }

    // ── Data ──

    #[test]
    fn data_borsh_round_trip() {
        let original = Data {
            name: "Test NFT".to_string(),
            symbol: "TNFT".to_string(),
            uri: "https://example.com/meta.json".to_string(),
            seller_fee_basis_points: 500,
            creators: Some(vec![Creator {
                address: test_pubkey(1),
                verified: true,
                share: 100,
            }]),
        };

        let bytes = original.try_to_vec().unwrap();
        let decoded = Data::try_from_slice(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn data_round_trip_with_no_creators() {
        let original = Data {
            name: "Minimal".to_string(),
            symbol: "M".to_string(),
            uri: "https://x.com".to_string(),
            seller_fee_basis_points: 0,
            creators: None,
        };

        let bytes = original.try_to_vec().unwrap();
        let decoded = Data::try_from_slice(&bytes).unwrap();
        assert_eq!(decoded.creators, None);
    }

    #[test]
    fn data_round_trip_with_multiple_creators() {
        let creators: Vec<Creator> = (0..5)
            .map(|i| Creator {
                address: test_pubkey(i),
                verified: i == 0,
                share: if i == 0 { 60 } else { 10 },
            })
            .collect();

        let original = Data {
            name: "Multi".to_string(),
            symbol: "ML".to_string(),
            uri: "https://example.com".to_string(),
            seller_fee_basis_points: 250,
            creators: Some(creators),
        };

        let bytes = original.try_to_vec().unwrap();
        let decoded = Data::try_from_slice(&bytes).unwrap();
        assert_eq!(decoded.creators.as_ref().unwrap().len(), 5);
        assert_eq!(decoded.creators.as_ref().unwrap()[0].share, 60);
    }

    // ── Creator ──

    #[test]
    fn creator_borsh_round_trip() {
        let creator = Creator {
            address: test_pubkey(42),
            verified: false,
            share: 50,
        };

        let bytes = creator.try_to_vec().unwrap();
        let decoded = Creator::try_from_slice(&bytes).unwrap();
        assert_eq!(creator, decoded);
    }

    #[test]
    fn creator_serialized_size_matches_constant() {
        let creator = Creator {
            address: test_pubkey(0),
            verified: true,
            share: 100,
        };

        assert_eq!(creator.try_to_vec().unwrap().len(), MAX_CREATOR_LEN);
    }

    // ── Edition ──

    #[test]
    fn edition_borsh_round_trip() {
        let edition = Edition {
            key: Key::EditionV1,
            parent: test_pubkey(1),
            edition: 42,
        };

        let bytes = edition.try_to_vec().unwrap();
        let decoded = Edition::try_from_slice(&bytes).unwrap();
        assert_eq!(edition, decoded);
    }

    #[test]
    fn edition_zero_is_master() {
        let edition = Edition {
            key: Key::EditionV1,
            parent: test_pubkey(1),
            edition: 0,
        };

        let bytes = edition.try_to_vec().unwrap();
        let decoded = Edition::try_from_slice(&bytes).unwrap();
        assert_eq!(decoded.edition, 0);
    }

    // ── MasterEdition ──

    #[test]
    fn master_edition_borsh_round_trip_with_max_supply() {
        let me = MasterEdition {
            key: Key::MasterEditionV1,
            supply: 5,
            max_supply: Some(100),
            printing_mint: test_pubkey(10),
            one_time_printing_authorization_mint: test_pubkey(20),
        };

        let bytes = me.try_to_vec().unwrap();
        let decoded = MasterEdition::try_from_slice(&bytes).unwrap();
        assert_eq!(me, decoded);
    }

    #[test]
    fn master_edition_borsh_round_trip_unlimited() {
        let me = MasterEdition {
            key: Key::MasterEditionV1,
            supply: 0,
            max_supply: None,
            printing_mint: test_pubkey(10),
            one_time_printing_authorization_mint: test_pubkey(20),
        };

        let bytes = me.try_to_vec().unwrap();
        let decoded = MasterEdition::try_from_slice(&bytes).unwrap();
        assert_eq!(decoded.max_supply, None);
    }

    // ── ReservationV1 / ReservationListV1 ──

    #[test]
    fn reservation_v1_borsh_round_trip() {
        let r = ReservationV1 {
            address: test_pubkey(1),
            spots_remaining: 5,
            total_spots: 10,
        };

        let bytes = r.try_to_vec().unwrap();
        let decoded = ReservationV1::try_from_slice(&bytes).unwrap();
        assert_eq!(r, decoded);
    }

    #[test]
    fn reservation_list_v1_borsh_round_trip() {
        let list = ReservationListV1 {
            key: Key::ReservationListV1,
            master_edition: test_pubkey(1),
            supply_snapshot: Some(50),
            reservations: vec![ReservationV1 {
                address: test_pubkey(2),
                spots_remaining: 3,
                total_spots: 5,
            }],
        };

        let bytes = list.try_to_vec().unwrap();
        let decoded = ReservationListV1::try_from_slice(&bytes).unwrap();
        assert_eq!(list, decoded);
    }

    // ── Reservation / ReservationListV2 ──

    #[test]
    fn reservation_borsh_round_trip() {
        let r = Reservation {
            address: test_pubkey(1),
            spots_remaining: 1000,
            total_spots: 5000,
        };

        let bytes = r.try_to_vec().unwrap();
        let decoded = Reservation::try_from_slice(&bytes).unwrap();
        assert_eq!(r, decoded);
    }

    #[test]
    fn reservation_list_v2_borsh_round_trip() {
        let list = ReservationListV2 {
            key: Key::ReservationListV2,
            master_edition: test_pubkey(10),
            supply_snapshot: None,
            reservations: vec![
                Reservation {
                    address: test_pubkey(1),
                    spots_remaining: 10,
                    total_spots: 10,
                },
                Reservation {
                    address: test_pubkey(2),
                    spots_remaining: 0,
                    total_spots: 5,
                },
            ],
        };

        let bytes = list.try_to_vec().unwrap();
        let decoded = ReservationListV2::try_from_slice(&bytes).unwrap();
        assert_eq!(list, decoded);
    }

    // ── ReservationList trait on V1 ──

    #[test]
    fn reservation_list_v1_trait_converts_to_v2_format() {
        let mut list = ReservationListV1 {
            key: Key::ReservationListV1,
            master_edition: test_pubkey(1),
            supply_snapshot: Some(100),
            reservations: vec![ReservationV1 {
                address: test_pubkey(2),
                spots_remaining: 3,
                total_spots: 5,
            }],
        };

        let reservations = list.reservations();
        assert_eq!(reservations[0].spots_remaining, 3);
        assert_eq!(reservations[0].total_spots, 5);

        list.set_supply_snapshot(Some(200));
        assert_eq!(list.supply_snapshot(), Some(200));

        list.set_master_edition(test_pubkey(99));
        assert_eq!(list.master_edition(), test_pubkey(99));
    }

    // ── Constants sanity ──

    #[test]
    fn max_creator_len_is_pubkey_plus_two() {
        assert_eq!(MAX_CREATOR_LEN, 32 + 1 + 1);
    }

    #[test]
    fn max_edition_len_has_room_for_padding() {
        assert_eq!(MAX_EDITION_LEN, 1 + 32 + 8 + 200);
    }

    #[test]
    fn max_master_edition_len_has_room_for_padding() {
        assert_eq!(MAX_MASTER_EDITION_LEN, 1 + 9 + 8 + 32 + 32 + 200);
    }

    #[test]
    fn max_reservation_list_size_accounts_for_48_byte_reservations() {
        assert_eq!(
            MAX_RESERVATION_LIST_SIZE,
            1 + 32 + 8 + 8 + MAX_RESERVATIONS * 48 + 100
        );
    }
}
