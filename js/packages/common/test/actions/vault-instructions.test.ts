import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';
import '../../src/utils/borsh';
import {
  initVault,
  addTokenToInactiveVault,
  activateVault,
  combineVault,
  withdrawTokenFromSafetyDepositBox,
  updateExternalPriceAccount,
  getSafetyDepositBox,
  getSafetyDepositBoxAddress,
  ExternalPriceAccount,
  VAULT_PREFIX,
} from '../../src/actions/vault';
import { programIds } from '../../src/utils/ids';

const randomPubkey = () =>
  new PublicKey(Buffer.alloc(32).fill(Math.random() * 255));

describe('Vault instruction builders', () => {
  describe('initVault', () => {
    it('pushes one instruction with 8 account keys', async () => {
      const instructions: any[] = [];
      await initVault(
        false,
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(8);
    });

    it('instruction data starts with byte 0 (InitVault)', async () => {
      const instructions: any[] = [];
      await initVault(
        true,
        randomPubkey(),
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

  describe('addTokenToInactiveVault', () => {
    it('pushes one instruction with 10 account keys', async () => {
      const instructions: any[] = [];
      await addTokenToInactiveVault(
        new BN(1),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(10);
    });

    it('instruction data starts with byte 1', async () => {
      const instructions: any[] = [];
      await addTokenToInactiveVault(
        new BN(5),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions[0].data[0]).toBe(1);
    });
  });

  describe('activateVault', () => {
    it('pushes one instruction with 6 account keys', async () => {
      const instructions: any[] = [];
      await activateVault(
        new BN(100),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(6);
    });

    it('instruction data starts with byte 2 (ActivateVault)', async () => {
      const instructions: any[] = [];
      await activateVault(
        new BN(50),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions[0].data[0]).toBe(2);
    });
  });

  describe('combineVault', () => {
    it('pushes one instruction with 12 account keys', async () => {
      const instructions: any[] = [];
      await combineVault(
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        undefined,
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(12);
    });

    it('instruction data is single byte 3', async () => {
      const instructions: any[] = [];
      await combineVault(
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions[0].data.length).toBe(1);
      expect(instructions[0].data[0]).toBe(3);
    });

    it('uses newVaultAuthority when provided', async () => {
      const vaultAuth = randomPubkey();
      const newAuth = randomPubkey();
      const instructions: any[] = [];

      await combineVault(
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        newAuth,
        vaultAuth,
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions[0].keys[6].pubkey.toBase58()).toBe(
        newAuth.toBase58(),
      );
    });

    it('falls back to vaultAuthority when newVaultAuthority is undefined', async () => {
      const vaultAuth = randomPubkey();
      const instructions: any[] = [];

      await combineVault(
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        undefined,
        vaultAuth,
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions[0].keys[6].pubkey.toBase58()).toBe(
        vaultAuth.toBase58(),
      );
    });
  });

  describe('withdrawTokenFromSafetyDepositBox', () => {
    it('pushes one instruction with 9 account keys', async () => {
      const instructions: any[] = [];
      await withdrawTokenFromSafetyDepositBox(
        new BN(1),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(9);
    });

    it('instruction data starts with byte 5', async () => {
      const instructions: any[] = [];
      await withdrawTokenFromSafetyDepositBox(
        new BN(10),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        randomPubkey(),
        instructions,
      );

      expect(instructions[0].data[0]).toBe(5);
    });
  });

  describe('updateExternalPriceAccount', () => {
    it('pushes one instruction with 1 account key', async () => {
      const instructions: any[] = [];
      const epa = new ExternalPriceAccount({
        pricePerShare: new BN(1000),
        priceMint: randomPubkey(),
        allowedToCombine: true,
      });

      await updateExternalPriceAccount(randomPubkey(), epa, instructions);

      expect(instructions.length).toBe(1);
      expect(instructions[0].keys.length).toBe(1);
    });

    it('instruction data starts with byte 9', async () => {
      const instructions: any[] = [];
      const epa = new ExternalPriceAccount({
        pricePerShare: new BN(0),
        priceMint: randomPubkey(),
        allowedToCombine: false,
      });

      await updateExternalPriceAccount(randomPubkey(), epa, instructions);

      expect(instructions[0].data[0]).toBe(9);
    });
  });
});

describe('Vault PDA derivation', () => {
  describe('getSafetyDepositBox', () => {
    it('is deterministic', async () => {
      const vault = randomPubkey();
      const tokenMint = randomPubkey();
      const a = await getSafetyDepositBox(vault, tokenMint);
      const b = await getSafetyDepositBox(vault, tokenMint);
      expect(a.toBase58()).toBe(b.toBase58());
    });

    it('uses VAULT_PREFIX seed', async () => {
      const vault = randomPubkey();
      const tokenMint = randomPubkey();
      const vaultProgramId = programIds().vault;

      const manual = (
        await PublicKey.findProgramAddress(
          [Buffer.from(VAULT_PREFIX), vault.toBuffer(), tokenMint.toBuffer()],
          vaultProgramId,
        )
      )[0];

      expect((await getSafetyDepositBox(vault, tokenMint)).toBase58()).toBe(
        manual.toBase58(),
      );
    });
  });

  describe('getSafetyDepositBoxAddress', () => {
    it('matches getSafetyDepositBox', async () => {
      const vault = randomPubkey();
      const tokenMint = randomPubkey();

      const a = await getSafetyDepositBox(vault, tokenMint);
      const b = await getSafetyDepositBoxAddress(vault, tokenMint);
      expect(a.toBase58()).toBe(b.toBase58());
    });
  });
});
