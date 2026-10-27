use {
    crate::utils::try_from_slice_checked,
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey},
};
/// prefix used for PDAs to avoid certain collision attacks (https://en.wikipedia.org/wiki/Collision_attack#Chosen-prefix_collision_attack)
pub const PREFIX: &str = "vault";

#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, Debug, PartialEq)]
pub enum Key {
    Uninitialized,
    SafetyDepositBoxV1,
    ExternalAccountKeyV1,
    VaultV1,
}

pub const MAX_SAFETY_DEPOSIT_SIZE: usize = 1 + 32 + 32 + 32 + 1;
pub const MAX_VAULT_SIZE: usize = 1 + 32 + 32 + 32 + 32 + 1 + 32 + 1 + 32 + 1 + 1 + 8;
pub const MAX_EXTERNAL_ACCOUNT_SIZE: usize = 1 + 8 + 32 + 1;
#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize, Debug, PartialEq)]
pub enum VaultState {
    Inactive,
    Active,
    Combined,
    Deactivated,
}

#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize)]
pub struct Vault {
    pub key: Key,
    /// Store token program used
    pub token_program: Pubkey,
    /// Mint that produces the fractional shares
    pub fraction_mint: Pubkey,
    /// Authority who can make changes to the vault
    pub authority: Pubkey,
    /// treasury where fractional shares are held for redemption by authority
    pub fraction_treasury: Pubkey,
    /// treasury where monies are held for fractional share holders to redeem(burn) shares once buyout is made
    pub redeem_treasury: Pubkey,
    /// Can authority mint more shares from fraction_mint after activation
    pub allow_further_share_creation: bool,

    /// Must point at an ExternalPriceAccount, which gives permission and price for buyout.
    pub pricing_lookup_address: Pubkey,
    /// In inactive state, we use this to set the order key on Safety Deposit Boxes being added and
    /// then we increment it and save so the next safety deposit box gets the next number.
    /// In the Combined state during token redemption by authority, we use it as a decrementing counter each time
    /// The authority of the vault withdrawals a Safety Deposit contents to count down how many
    /// are left to be opened and closed down. Once this hits zero, and the fraction mint has zero shares,
    /// then we can deactivate the vault.
    pub token_type_count: u8,
    pub state: VaultState,

    /// Once combination happens, we copy price per share to vault so that if something nefarious happens
    /// to external price account, like price change, we still have the math 'saved' for use in our calcs
    pub locked_price_per_share: u64,
}

impl Vault {
    pub fn from_account_info(a: &AccountInfo) -> Result<Vault, ProgramError> {
        let vt: Vault = try_from_slice_checked(&a.data.borrow_mut(), Key::VaultV1, MAX_VAULT_SIZE)?;

        Ok(vt)
    }
}

#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize)]
pub struct SafetyDepositBox {
    // Please note if you change this struct, be careful as we read directly off it
    // in Metaplex to avoid serialization costs...
    /// Each token type in a vault has it's own box that contains it's mint and a look-back
    pub key: Key,
    /// Key pointing to the parent vault
    pub vault: Pubkey,
    /// This particular token's mint
    pub token_mint: Pubkey,
    /// Account that stores the tokens under management
    pub store: Pubkey,
    /// the order in the array of registries
    pub order: u8,
}

impl SafetyDepositBox {
    pub fn from_account_info(a: &AccountInfo) -> Result<SafetyDepositBox, ProgramError> {
        let sd: SafetyDepositBox = try_from_slice_checked(
            &a.data.borrow_mut(),
            Key::SafetyDepositBoxV1,
            MAX_SAFETY_DEPOSIT_SIZE,
        )?;

        Ok(sd)
    }
}

#[repr(C)]
#[derive(Clone, BorshSerialize, BorshDeserialize)]
pub struct ExternalPriceAccount {
    pub key: Key,
    pub price_per_share: u64,
    /// Mint of the currency we are pricing the shares against, should be same as redeem_treasury.
    /// Most likely will be USDC mint most of the time.
    pub price_mint: Pubkey,
    /// Whether or not combination has been allowed for this vault.
    pub allowed_to_combine: bool,
}

impl ExternalPriceAccount {
    pub fn from_account_info(a: &AccountInfo) -> Result<ExternalPriceAccount, ProgramError> {
        let sd: ExternalPriceAccount = try_from_slice_checked(
            &a.data.borrow_mut(),
            Key::ExternalAccountKeyV1,
            MAX_EXTERNAL_ACCOUNT_SIZE,
        )?;

        Ok(sd)
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

    // ── Key enum ──

    #[test]
    fn key_enum_discriminants() {
        assert_eq!(Key::Uninitialized.try_to_vec().unwrap()[0], 0);
        assert_eq!(Key::SafetyDepositBoxV1.try_to_vec().unwrap()[0], 1);
        assert_eq!(Key::ExternalAccountKeyV1.try_to_vec().unwrap()[0], 2);
        assert_eq!(Key::VaultV1.try_to_vec().unwrap()[0], 3);
    }

    // ── VaultState enum ──

    #[test]
    fn vault_state_discriminants() {
        assert_eq!(VaultState::Inactive.try_to_vec().unwrap()[0], 0);
        assert_eq!(VaultState::Active.try_to_vec().unwrap()[0], 1);
        assert_eq!(VaultState::Combined.try_to_vec().unwrap()[0], 2);
        assert_eq!(VaultState::Deactivated.try_to_vec().unwrap()[0], 3);
    }

    // ── Vault ──

    #[test]
    fn vault_borsh_round_trip() {
        let original = Vault {
            key: Key::VaultV1,
            token_program: test_pubkey(1),
            fraction_mint: test_pubkey(2),
            authority: test_pubkey(3),
            fraction_treasury: test_pubkey(4),
            redeem_treasury: test_pubkey(5),
            allow_further_share_creation: true,
            pricing_lookup_address: test_pubkey(6),
            token_type_count: 3,
            state: VaultState::Active,
            locked_price_per_share: 1_000_000,
        };

        let bytes = original.try_to_vec().unwrap();
        let decoded = Vault::try_from_slice(&bytes).unwrap();

        assert_eq!(decoded.key, Key::VaultV1);
        assert_eq!(decoded.authority, test_pubkey(3));
        assert_eq!(decoded.token_type_count, 3);
        assert_eq!(decoded.state, VaultState::Active);
        assert_eq!(decoded.locked_price_per_share, 1_000_000);
        assert!(decoded.allow_further_share_creation);
    }

    #[test]
    fn vault_inactive_defaults() {
        let vault = Vault {
            key: Key::VaultV1,
            token_program: test_pubkey(1),
            fraction_mint: test_pubkey(2),
            authority: test_pubkey(3),
            fraction_treasury: test_pubkey(4),
            redeem_treasury: test_pubkey(5),
            allow_further_share_creation: false,
            pricing_lookup_address: test_pubkey(6),
            token_type_count: 0,
            state: VaultState::Inactive,
            locked_price_per_share: 0,
        };

        let bytes = vault.try_to_vec().unwrap();
        let decoded = Vault::try_from_slice(&bytes).unwrap();
        assert_eq!(decoded.state, VaultState::Inactive);
        assert_eq!(decoded.token_type_count, 0);
        assert_eq!(decoded.locked_price_per_share, 0);
        assert!(!decoded.allow_further_share_creation);
    }

    // ── SafetyDepositBox ──

    #[test]
    fn safety_deposit_box_borsh_round_trip() {
        let original = SafetyDepositBox {
            key: Key::SafetyDepositBoxV1,
            vault: test_pubkey(1),
            token_mint: test_pubkey(2),
            store: test_pubkey(3),
            order: 5,
        };

        let bytes = original.try_to_vec().unwrap();
        let decoded = SafetyDepositBox::try_from_slice(&bytes).unwrap();

        assert_eq!(decoded.key, Key::SafetyDepositBoxV1);
        assert_eq!(decoded.vault, test_pubkey(1));
        assert_eq!(decoded.token_mint, test_pubkey(2));
        assert_eq!(decoded.store, test_pubkey(3));
        assert_eq!(decoded.order, 5);
    }

    #[test]
    fn safety_deposit_box_serialized_size_matches_constant() {
        let sdb = SafetyDepositBox {
            key: Key::SafetyDepositBoxV1,
            vault: test_pubkey(0),
            token_mint: test_pubkey(0),
            store: test_pubkey(0),
            order: 0,
        };

        assert_eq!(sdb.try_to_vec().unwrap().len(), MAX_SAFETY_DEPOSIT_SIZE);
    }

    // ── ExternalPriceAccount ──

    #[test]
    fn external_price_account_borsh_round_trip() {
        let original = ExternalPriceAccount {
            key: Key::ExternalAccountKeyV1,
            price_per_share: 50_000_000,
            price_mint: test_pubkey(1),
            allowed_to_combine: true,
        };

        let bytes = original.try_to_vec().unwrap();
        let decoded = ExternalPriceAccount::try_from_slice(&bytes).unwrap();

        assert_eq!(decoded.key, Key::ExternalAccountKeyV1);
        assert_eq!(decoded.price_per_share, 50_000_000);
        assert_eq!(decoded.price_mint, test_pubkey(1));
        assert!(decoded.allowed_to_combine);
    }

    #[test]
    fn external_price_account_serialized_size_matches_constant() {
        let epa = ExternalPriceAccount {
            key: Key::ExternalAccountKeyV1,
            price_per_share: 0,
            price_mint: test_pubkey(0),
            allowed_to_combine: false,
        };

        assert_eq!(epa.try_to_vec().unwrap().len(), MAX_EXTERNAL_ACCOUNT_SIZE);
    }

    // ── Constants ──

    #[test]
    fn max_vault_size_matches_field_layout() {
        let expected = 1 + 32 + 32 + 32 + 32 + 1 + 32 + 1 + 32 + 1 + 1 + 8;
        assert_eq!(MAX_VAULT_SIZE, expected);
    }

    #[test]
    fn max_safety_deposit_size_matches_field_layout() {
        let expected = 1 + 32 + 32 + 32 + 1;
        assert_eq!(MAX_SAFETY_DEPOSIT_SIZE, expected);
    }

    #[test]
    fn max_external_account_size_matches_field_layout() {
        let expected = 1 + 8 + 32 + 1;
        assert_eq!(MAX_EXTERNAL_ACCOUNT_SIZE, expected);
    }
}
