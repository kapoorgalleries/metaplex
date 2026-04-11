# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Repository Overview

Metaplex is a protocol built on top of Solana for NFTs, auctions, and storefronts. The repository is a monorepo split into two top-level halves:

- `rust/` — four on-chain Solana programs (BPF) that make up the Metaplex protocol
- `js/` — a Yarn + Lerna monorepo containing a shared library (`@oyster/common`) and a React storefront (`web`) that call the on-chain programs
- `docs/` — light supplementary docs (e.g. `create-store.md`); the full architecture guide lives on Notion (see `README.md`)

There is no single unified build — the Rust and JavaScript trees are developed and built independently. CI only builds Rust (`.github/workflows/pull-request.yml` is scoped to `./rust`).

## Rust: On-chain Programs

### Workspace layout

`rust/Cargo.toml` is a Cargo workspace whose members are:

| Crate path | Name | Program ID | Role |
|---|---|---|---|
| `rust/auction/program` | `spl-auction` | `auctxRXPeJoc4817jDhf4HbjnhEcr1cCXenosMhK5R8` | Generic English-auction program used by Metaplex |
| `rust/token-vault/program` | `spl-token-vault` | `vau1zxA2LbssAUEF7Gpw91zMM1LvXrvpzJtmZ58rPsn` | Token fractionalization / vault (holds safety deposit boxes) |
| `rust/token-metadata/program` | `spl-token-metadata` | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` | NFT metadata, Master Editions, Prints |
| `rust/metaplex/program` | `spl-metaplex` | `p1exdMJcjVao65QdewkaZRUnU6VPSXhus9n2GzWfh98` | Auction manager that orchestrates the three above |

Program IDs are declared via `solana_program::declare_id!` in each crate's `src/lib.rs`. Do not change these without understanding downstream consequences — the JS side references the same pubkeys.

The `metaplex` program depends on `auction`, `token-vault`, and `token-metadata` crates via `path = ...` with the `no-entrypoint` feature so they link as libraries rather than register a second BPF entrypoint.

Each program crate follows the same file layout:

```
src/
  entrypoint.rs   # BPF entrypoint (gated behind the default feature; disabled with `no-entrypoint`)
  error.rs        # ProgramError variants (thiserror + num-derive)
  instruction.rs  # Borsh-serialized instruction enums and helpers to build Instructions
  processor.rs    # Top-level instruction dispatch (and `processor/` submodule for per-instruction handlers)
  state.rs        # On-chain account layouts + size constants (where applicable)
  utils.rs        # Shared helpers (PDA derivation, account validation, etc.)
  lib.rs          # Re-exports + declare_id!
```

The `auction` and `metaplex` programs split their `processor.rs` into a `processor/` directory with one file per instruction (e.g. `place_bid.rs`, `redeem_bid.rs`). When adding a new instruction, follow that pattern: add a variant to `instruction.rs`, a handler file under `processor/`, dispatch from `processor.rs`, and add any new errors to `error.rs`.

Test crates live next to each program as sibling directories (`rust/metaplex/test`, `rust/token-metadata/test`, `rust/token-vault/test`). These are Cargo binaries that exercise the programs against a `solana-program-test` bank.

### Conventions

- **Borsh** (`borsh = "0.8.2"`) is used for all instruction and state serialization. Match the JS side (`borsh = "^0.4.0"` in `@oyster/common`) — layout changes must be coordinated across both.
- **PDAs** use a string prefix constant defined in the crate's `state.rs` or `lib.rs` (e.g. `PREFIX = "metaplex"`, `PREFIX = "auction"`, also `EXTENDED = "extended"` for auctions). Reuse these constants — never hardcode the string in derivations.
- **Account size constants** like `MAX_AUCTION_MANAGER_SIZE` in `rust/metaplex/program/src/state.rs` are hand-counted. The file explicitly warns `// DONT TRUST MEM SIZE OF!` — when adding fields, update the constant by hand with a comment describing the layout contribution (copy the existing style).
- **Padding** is baked into size constants for forward compatibility (e.g. `+ 150` padding on `MAX_AUCTION_MANAGER_SIZE`). Prefer consuming padding to bumping account sizes.
- **Solana SDK version** is pinned to `solana-program = "1.6.10"`. Don't bump individual crates; use `rust/update-solana-dependencies.sh <ver>` to update all Cargo.toml files in lockstep, or `rust/patch.crates-io.sh <solana-monorepo>` to develop against a local Solana checkout.
- **Features**: every program exposes `no-entrypoint` (for library use) and `test-bpf` (for BPF tests).

### Build / test / lint

Rust CI lives in `rust/ci/` and is invoked by `.github/workflows/pull-request.yml`. Use the same commands locally:

```bash
cd rust

# format check (stable; must pass in CI)
cargo fmt --all -- --check

# clippy — note the nightly toolchain and -Dwarnings
cargo +nightly clippy -Zunstable-options --workspace --all-targets -- --deny=warnings

# full CI build + test (builds BPF programs then host tests)
./ci/cargo-build-test.sh
```

`ci/cargo-build-test.sh` sets `RUSTFLAGS="-D warnings"` and runs `cargo test-bpf -- --nocapture` then `cargo build` + `cargo test -- --nocapture`. It deletes `target/debug` between phases to avoid running out of disk on Actions runners.

Pinned toolchains live in `rust/ci/rust-version.sh` (currently `rust_stable=1.50.0`, `rust_nightly=nightly-2021-02-18`) and `rust/ci/solana-version.sh` (currently `v1.6.2`). First-time setup:

```bash
./ci/install-build-deps.sh       # installs solana and bpf deps
./ci/install-program-deps.sh     # installs rustfilt, honggfuzz, build-bpf
```

Built `.so` artifacts land in `rust/target/deploy/`; CI uploads them as the `programs` workflow artifact.

## JavaScript: `js/`

### Workspace layout

`js/package.json` is a private Yarn workspace managed by **Lerna 3.22.1** (`lerna.json`). Two packages:

- `js/packages/common` — published as `@oyster/common` (version `0.0.1`). Shared library exporting `actions`, `models`, `contexts`, `hooks`, `components`, `utils`, `constants`, `wallet-adapters`. Its `main` is `dist/lib/index.js`, so **downstream packages import from the built output**, not from `src/`.
- `js/packages/web` — the React storefront (CRA + CRACO + Less). Consumes `@oyster/common`.

`common/src/` subtree:

```
actions/         # high-level transaction builders (account.ts, auction.ts, metadata.ts, vault.ts)
models/          # account deserializers (TokenAccount, tokenSwap, etc.)
contexts/        # React contexts (accounts, connection, wallet)
components/
hooks/
constants/
utils/
wallet-adapters/
types/
```

`web/src/` subtree:

```
App.tsx, routes.tsx, index.tsx       # shell
actions/                             # storefront-specific flows (createAuctionManager, sendPlaceBid, sendRedeemBid, settle, saveAdmin, …)
views/                               # top-level routed pages (home, art, artCreate, auction, auctionCreate, admin, artists, artworks, artist)
components/, contexts/, hooks/       # UI + state
config/                              # incl. userNames.json — creator allowlist display data
models/, utils/, types/, constants/
```

When adding a storefront flow that builds a transaction, the pattern is: put reusable instruction builders in `common/src/actions/`, and compose them into a user-facing flow under `web/src/actions/` (see `createAuctionManager.ts`, `sendPlaceBid.ts`).

### Build / run

Requires **Node 12.16.2** and **Yarn 1.22.10** (see `js/README.md`). From `js/`:

```bash
yarn bootstrap           # lerna link && lerna bootstrap — installs deps in both packages
yarn start               # runs @oyster/common watchers AND the web dev server in parallel
yarn build               # lerna run build (tsc in common, craco build in web)
yarn test                # lerna run test --concurrency 1 --stream
yarn lint                # eslint + prettier -c over packages/*/{src,test}/**/*.ts
yarn lint:fix            # eslint --fix + prettier --write
```

`./deploy-web.sh` is the canonical production-ish build script: `yarn bootstrap`, then `yarn prepare && yarn build-css` in common, then `yarn prestart && yarn build` in web. It sets `CI=false` intentionally so lint warnings don't fail the build ("TODO: fix linting errors!" is an explicit comment — don't silently re-enable this without addressing the lint debt).

**Rebuilding common is often required** for changes to show up in web because web imports from `common/dist/lib/`. `common`'s `start` script runs three watchers in parallel (`tsc --watch`, `less-watch-compiler` against both `src/` and `dist/lib/`). If you see missing CSS errors, re-run:

```bash
lerna exec npm install --scope @oyster/common
lerna exec npm watch-css-src --scope @oyster/common
```

### Conventions

- **TypeScript strict mode** is on at the root `js/tsconfig.json` (`strict`, `noImplicitAny`). Each package has its own tsconfig extending the root.
- **Prettier config** (from `js/package.json`): `arrowParens: avoid`, `semi: true`, `singleQuote: true`, `trailingComma: all`. `.editorconfig` enforces 2-space indent and LF line endings.
- **Husky pre-commit** runs `lint-staged` → `prettier --write` on staged `packages/*/{src,test}/**/*.ts`.
- **Commitlint** uses `@commitlint/config-conventional` — PR titles and commits should follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.). Lerna's release command also relies on this.
- **React is pinned to 17.0.2** via workspace `resolutions`, even though `web/package.json` still lists `16.13.1` in its own deps. Don't "fix" that mismatch without understanding the `resolutions` behavior.
- **Less** is used for styling; `.css` files are gitignored (`.gitignore` line 13) except for a small allowlist. `@oyster/common` compiles `.less` → `.css` next to source and into `dist/lib/` via `less-watch-compiler`.
- **Store owner** is configured at build time via the env var `REACT_APP_STORE_OWNER_ADDRESS_ADDRESS` in `js/packages/web/.env` (see `docs/create-store.md`).

## Cross-cutting workflows

- **On-chain ↔ client sync**: Borsh layouts in `rust/**/state.rs` and `rust/**/instruction.rs` are the source of truth; their JS counterparts live in `js/packages/common/src/actions/` and `js/packages/common/src/models/`. Changes must be made on both sides in the same PR.
- **Program ID changes**: Update the `declare_id!` in `rust/**/lib.rs` AND any mirrored constant in the JS packages. Grep both trees before committing.
- **New Solana SDK version**: Run `rust/update-solana-dependencies.sh <new_ver>` and also bump `ci/solana-version.sh`.

## CI, merges, and branches

- CI: `.github/workflows/pull-request.yml` runs `rustfmt`, `clippy`, and `cargo-build-test` on every PR and push to `master`. **There is no JS CI job** — JS lint/tests must be run locally.
- Auto-merge: `.mergify.yml` will squash-merge (or rebase for users in `@dont-squash-my-commits`) when a PR has the `automerge` label and `all_github_action_checks` passes; it auto-removes the label on CI failure and dismisses stale reviews on `base=master`.
- Default branch is `master`. Lerna publish is allowed from `master` or `next` only.
- `.travis/affects.sh` is a legacy helper to skip jobs when a path prefix is untouched — currently unused by GitHub Actions.

## House rules for code changes in this repo

- Preserve Rust account-size constants when editing `state.rs` — update the hand-counted comment and consume padding before growing total size.
- Keep `no-entrypoint` feature gates intact on library uses; only `entrypoint.rs` should register the BPF entrypoint.
- Don't add a new top-level workspace member without also wiring it into `rust/Cargo.toml` and, if it needs to be built in CI, confirming `cargo-build-test.sh` will pick it up.
- Avoid touching `js/yarn.lock` by hand — let `yarn` manage it. Same for `rust/Cargo.lock`.
- When editing the web storefront, changes in `@oyster/common` require its `dist/` to be rebuilt (the watcher handles this while `yarn start` is running).
- Match existing code style — this codebase does not use Prettier/ESLint aggressively on every file, and large reformatting PRs are discouraged.
