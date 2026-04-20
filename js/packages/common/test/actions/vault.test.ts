import { PublicKey } from '@solana/web3.js';
import { serialize, deserializeUnchecked } from 'borsh';
import BN from 'bn.js';
import '../../src/utils/borsh';
import {
  Vault,
  VaultKey,
  VaultState,
  SafetyDepositBox,
  ExternalPriceAccount,
  VAULT_SCHEMA,
  decodeVault,
  decodeSafetyDeposit,
  MAX_VAULT_SIZE,
  MAX_EXTERNAL_ACCOUNT_SIZE,
} from '../../src/actions/vault';

const randomPubkey = () =>
  new PublicKey(Buffer.alloc(32).fill(Math.random() * 255));

describe('Vault Borsh serialization', () => {
  describe('Vault', () => {
    it('round-trips a full Vault struct', () => {
      const tokenProgram = randomPubkey();
      const fractionMint = randomPubkey();
      const authority = randomPubkey();

      const original = new Vault({
        tokenProgram,
        fractionMint,
        authority,
        fractionTreasury: randomPubkey(),
        redeemTreasury: randomPubkey(),
        allowFurtherShareCreation: true,
        pricingLookupAddress: randomPubkey(),
        tokenTypeCount: 3,
        state: VaultState.Active,
        lockedPricePerShare: new BN(1_000_000),
      });

      const data = Buffer.from(serialize(VAULT_SCHEMA, original));
      const decoded = decodeVault(data);

      expect(decoded.key).toBe(VaultKey.VaultV1);
      expect(decoded.tokenProgram.toBase58()).toBe(tokenProgram.toBase58());
      expect(decoded.fractionMint.toBase58()).toBe(fractionMint.toBase58());
      expect(decoded.authority.toBase58()).toBe(authority.toBase58());
      expect(decoded.state).toBe(VaultState.Active);
      expect(decoded.tokenTypeCount).toBe(3);
      expect(decoded.lockedPricePerShare.eq(new BN(1_000_000))).toBe(true);
    });

    it('handles Inactive state with zero price', () => {
      const original = new Vault({
        tokenProgram: randomPubkey(),
        fractionMint: randomPubkey(),
        authority: randomPubkey(),
        fractionTreasury: randomPubkey(),
        redeemTreasury: randomPubkey(),
        allowFurtherShareCreation: false,
        pricingLookupAddress: randomPubkey(),
        tokenTypeCount: 0,
        state: VaultState.Inactive,
        lockedPricePerShare: new BN(0),
      });

      const data = Buffer.from(serialize(VAULT_SCHEMA, original));
      const decoded = decodeVault(data);
      expect(decoded.state).toBe(VaultState.Inactive);
      expect(decoded.tokenTypeCount).toBe(0);
      expect(decoded.lockedPricePerShare.eq(new BN(0))).toBe(true);
    });
  });

  describe('SafetyDepositBox', () => {
    it('round-trips', () => {
      const vault = randomPubkey();
      const tokenMint = randomPubkey();
      const store = randomPubkey();

      const original = new SafetyDepositBox({
        vault,
        tokenMint,
        store,
        order: 2,
      });

      const data = Buffer.from(serialize(VAULT_SCHEMA, original));
      const decoded = decodeSafetyDeposit(data);

      expect(decoded.key).toBe(VaultKey.SafetyDepositBoxV1);
      expect(decoded.vault.toBase58()).toBe(vault.toBase58());
      expect(decoded.tokenMint.toBase58()).toBe(tokenMint.toBase58());
      expect(decoded.store.toBase58()).toBe(store.toBase58());
      expect(decoded.order).toBe(2);
    });
  });

  describe('ExternalPriceAccount', () => {
    it('round-trips', () => {
      const priceMint = randomPubkey();
      const original = new ExternalPriceAccount({
        pricePerShare: new BN(50_000_000),
        priceMint,
        allowedToCombine: true,
      });

      const data = Buffer.from(serialize(VAULT_SCHEMA, original));
      const decoded = deserializeUnchecked(
        VAULT_SCHEMA,
        ExternalPriceAccount,
        data,
      ) as ExternalPriceAccount;

      expect(decoded.key).toBe(VaultKey.ExternalPriceAccountV1);
      expect(decoded.pricePerShare.eq(new BN(50_000_000))).toBe(true);
      expect(decoded.priceMint.toBase58()).toBe(priceMint.toBase58());
    });

    it('round-trips with combine disallowed', () => {
      const original = new ExternalPriceAccount({
        pricePerShare: new BN(0),
        priceMint: randomPubkey(),
        allowedToCombine: false,
      });

      const data = Buffer.from(serialize(VAULT_SCHEMA, original));
      const decoded = deserializeUnchecked(
        VAULT_SCHEMA,
        ExternalPriceAccount,
        data,
      ) as ExternalPriceAccount;

      expect(decoded.pricePerShare.eq(new BN(0))).toBe(true);
    });
  });
});

describe('Vault constants', () => {
  it('MAX_VAULT_SIZE matches field sizes', () => {
    const expected = 1 + 32 + 32 + 32 + 32 + 1 + 32 + 1 + 32 + 1 + 1 + 8;
    expect(MAX_VAULT_SIZE).toBe(expected);
  });

  it('MAX_EXTERNAL_ACCOUNT_SIZE matches field sizes', () => {
    expect(MAX_EXTERNAL_ACCOUNT_SIZE).toBe(1 + 8 + 32 + 1);
  });
});

describe('VaultState enum values', () => {
  it('has correct numeric values', () => {
    expect(VaultState.Inactive).toBe(0);
    expect(VaultState.Active).toBe(1);
    expect(VaultState.Combined).toBe(2);
    expect(VaultState.Deactivated).toBe(3);
  });
});

describe('VaultKey enum values', () => {
  it('has correct discriminants', () => {
    expect(VaultKey.Uninitialized).toBe(0);
    expect(VaultKey.SafetyDepositBoxV1).toBe(1);
    expect(VaultKey.ExternalPriceAccountV1).toBe(2);
    expect(VaultKey.VaultV1).toBe(3);
  });
});
