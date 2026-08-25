# Governance

## Overview

The Verdant Bond Protocol is governed on-chain by the `Governance` contract
(`contracts/governance/src/lib.rs`), a timelocked multi-signature system
backed by a 3-of-5 signer set.  All protocol-parameter changes flow through
`propose → approve → timelock → execute` and are enforced at the contract
level — no off-chain social consensus is relied upon.

---

## Multi-Stakeholder Committee

- Project Developers
- Bond Issuers
- Oracle Providers
- Protocol Maintainers
- Token Holders

---

## Governance Parameters

| Parameter | Value | Storage key |
|---|---|---|
| Signer set | 5 Stellar addresses | `DataKey::Signers` |
| Approval threshold | 3 of 5 | `DataKey::Threshold` |
| Timelock | 48 hours (172 800 s) | `DataKey::TimelockSeconds` |
| Nonce scheme | Per-address, monotonically increasing | `DataKey::Nonce(addr)` |
| Execution nonce | Per-target-contract, monotonic | `DataKey::ExecutionNonce(target)` |

---

## Governance Actions

The following protocol parameters require multi-sig governance approval:

- Add/remove oracle providers
- Update credit conversion factors
- Deploy contract upgrades (subject to 48-hour timelock)
- Modify KYC requirements
- Adjust dispute resolution parameters

Governance proposals are submitted via on-chain transactions and ratified by a
3-of-5 multi-sig held across geographically distributed keyholders.

---

## Sequence Diagram — Proposal Lifecycle

```
 Signer A          Governance Contract           Target Contract
    │                       │                          │
    │  1. propose()         │                          │
    │ ─────────────────────►│                          │
    │   (target, method,    │                          │
    │    args, description) │                          │
    │                       │                          │
    │  2. vote_approve()    │                          │
    │ ─────────────────────►│                          │
    │                       │                          │
    │  3. vote_approve()    │                          │
    │ ─────────────────────►│                          │
    │                       │                          │
    │  4. vote_approve()    │                          │
    │ ─────────────────────►│                          │
    │                       │                          │
    │              ┌────────┤                          │
    │              │ Threshold met → Queued            │
    │              │ queued_at = now                   │
    │              └────────┤                          │
    │                       │                          │
    │          ... 48h timelock elapses ...            │
    │                       │                          │
    │  5. execute()         │                          │
    │ ─────────────────────►│                          │
    │                       │                          │
    │              ┌────────┤  invoke_contract()       │
    │              │──────────────────────────────────►│
    │              │  args = [gov_addr, ...user_args,  │
    │              │          exec_nonce]               │
    │              └────────┤                          │
    │                       │◄─────────────────────────│
    │              ┌────────┤  return                  │
    │              │ Proposal → Executed               │
    │              └────────┤                          │
```

### Status transitions

```
  ┌──────────┐   propose()    ┌─────────┐  threshold met  ┌────────┐
  │ (none)   │──────────────►│ Pending │────────────────►│ Queued │
  └──────────┘               └─────────┘                 └────────┘
                                  │                          │
                                  │  threshold vetoes        │  timelock elapsed
                                  │  ┌────────────┐          │  + execute()
                                  │  ▼            │          │  ┌───────────┐
                                  │  Rejected     │          │  ▼           │
                                  │               │          │  Executed    │
                                  │  cancel()     │          └───────────┘
                                  │  ┌──────────┐ │
                                  │  ▼          │ │
                                  │  Cancelled  │ │
                                  └────────────┘ │
```

---

## Constructing a `propose()` Call

### Contract signature

```rust
pub fn propose(
    env: Env,
    caller: Address,       // must be a current signer
    target: Address,       // contract to be invoked on execution
    method: Symbol,        // function name on `target`
    args: Vec<Val>,        // Soroban-encoded arguments (excluding caller + nonce)
    description: Symbol,   // human-readable label (on-chain, ≤ 32 bytes)
    nonce: u64,            // caller's next expected nonce (starts at 0)
) -> Result<u64, GovernanceError>
```

### How `args` are encoded

`args` is a `soroban_sdk::Vec<Val>` — a Soroban-native vector of tagged
values.  Each element must be a `Val` produced by calling `.into_val(&env)`
on the corresponding Soroban type.  The table below maps common Rust types
to their Soroban `Val` encoding:

| Rust type | `Val` encoding | Example |
|---|---|---|
| `u32` | `Val::U32` | `42u32.into_val(&env)` |
| `i128` | `Val::I128` | `1_000_000i128.into_val(&env)` |
| `u64` | `Val::U64` | `123u64.into_val(&env)` |
| `Address` | `Val::Address` | `addr.into_val(&env)` |
| `BytesN<32>` | `Val::BytesN` | `hash.into_val(&env)` |
| `Symbol` | `Val::Symbol` | `Symbol::new(&env, "VCS").into_val(&env)` |
| `bool` | `Val::Bool` | `true.into_val(&env)` |

For struct / enum types declared with `#[contracttype]`, use `.into_val(&env)`
directly — Soroban's guest-side serialisation handles the recursive encoding.

### Worked example — approve a project via governance

This mirrors the end-to-end test at
`contracts/governance/src/lib.rs:694`.

Suppose the `ProjectRegistry` contract is deployed at address `REGISTRY_ADDR`
and has an `approve_project(caller, project_id, nonce)` function.  To route
an approval through governance:

```rust
use soroban_sdk::{vec, Address, Env, Symbol, IntoVal};

fn build_approve_proposal(
    env: &Env,
    registry_id: Address,
    project_id: u64,
) -> Vec<soroban_sdk::Val> {
    // Only the *positional arguments after `caller`* go into `args`.
    // The governance contract prepends itself as `caller` and appends an
    // execution nonce at the end when it calls `invoke_contract`.
    //
    // For approve_project(caller, project_id, nonce):
    //   caller  ← prepended by governance
    //   project_id ← included here
    //   nonce   ← appended by governance
    vec![
        &env,
        project_id.into_val(env),   // u64 → Val::U64
    ]
}
```

#### Full `soroban contract invoke` from the CLI

```bash
# Assume:
GOV_ID=C...          # Governance contract address
REGISTRY_ID=C...     # ProjectRegistry contract address
SIGNER_KEY=S...      # Secret key of a current signer

# 1. Fetch current nonce for this signer
NONCE=0  # query Governance.get_nonce() or start at 0

# 2. Build the args Vec — one u64 element (project_id = 1)
ARGS='{"vec":[{"u64":1}]}'

# 3. Submit the proposal
soroban contract invoke \
  --id "$GOV_ID" \
  --fn propose \
  --arg "$SIGNER_KEY" \
  --arg "$REGISTRY_ID" \
  --arg approve_project \
  --arg "$ARGS" \
  --arg "approve-vcs-1234" \
  --arg "$NONCE" \
  --network testnet \
  --source-account "$SIGNER_KEY"
```

#### Assembling `args` from a JavaScript / TypeScript client

```typescript
import { Address, Contract, SorobanRpc, xdr } from "soroban-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

// The args vector must be encoded as xdr.ScVal[]
const args: xdr.ScVal[] = [
  // project_id: u64 = 1
  xdr.ScVal.scvU64(1),
];

// For a more complex example — register_provider(admin, provider, methodology, nonce):
// args = [ address(Provider), symbol("VCS") ]
const argsComplex: xdr.ScVal[] = [
  xdr.ScVal.scvAddress(
    Address.fromString("GBOR...").toScAddress()
  ),
  xdr.ScVal.scvSymbol("VCS"),
];
```

#### What happens at execution time

When `execute()` is called and the timelock has elapsed, the governance
contract constructs the full argument vector and calls `invoke_contract`:

```rust
// From contracts/governance/src/lib.rs:336-341
let mut full_args: Vec<Val> = vec![
    &env,
    env.current_contract_address().into_val(&env)  // governance as caller
];
for arg in proposal.args.iter() {
    full_args.push_back(arg);
}
full_args.push_back(exec_nonce.into_val(&env));    // replay-protection nonce

env.invoke_contract::<Val>(&proposal.target, &proposal.method, full_args);
```

This means the target method's **first** argument must always be `caller:
Address` (receives the governance contract address), and its **last**
argument must be `nonce: u64` (receives the execution nonce).  All user
supplied `args` are sandwiched in between.

---

## Querying Governance State

| Method | Returns |
|---|---|
| `get_proposal(id)` | Full `Proposal` struct with status, vote counts, timestamps |
| `get_vote(id, signer)` | `true` if signer approved, `false` otherwise |
| `proposal_count()` | Total number of proposals ever created |
| `get_signers()` | Current signer set |
| `get_threshold()` | Current approval threshold |
| `get_timelock()` | Current timelock duration in seconds |
| `is_signer(address)` | `true` if address is a current signer |

---

## Current Limitations

### No signer rotation mechanism

The signer set and threshold are fixed at construction time
(`__constructor(signers, threshold, timelock_seconds)`) and there is
currently **no on-chain function to change them after deployment**.  If a
signer key is compromised or a keyholder becomes unavailable, the only
recovery path is to deploy a new `Governance` contract and migrate all
admin roles — a disruptive, high-privilege operation.

> Tracked in: issue/PR TBD — needs `rotate_signers(new_signers, new_threshold)`
> gated by the existing threshold.

### No target / method allow-list

Any signer can propose a call to **any contract address with any method
symbol**.  There is no on-chain allow-list restricting which contracts
or functions governance is permitted to invoke.  A compromised signer could
propose an arbitrary call to an unrelated contract.

> Tracked in: issue/PR TBD — consider a `DataKey::AllowedTargets` set and
> `DataKey::AllowedMethods(target)` map enforced in `propose()`.

### Mainnet deploy script does not wire in the Governance contract

`scripts/deploy-mainnet.sh` deploys seven contracts (`project-registry`,
`bond-issuer`, `coupon-engine`, `oracle-consumer`, `dex-router`,
`credit-retirement`, and the `shared` library) but **does not deploy or
reference the `governance` contract**.  The `CONTRACTS` array and
`PKG_MAP` / `ENV_MAP` lack an entry for governance.

Critically, none of the target contracts are initialised with the
governance contract address as their admin — they are all set to
`STELLAR_PUBLIC_KEY` (an EOA).  This means governance proposals that
target `approve_project`, `register_provider`, or similar admin-gated
functions will fail at `require_admin()` unless the contract's admin is
manually re-pointed to the governance contract after deployment.

The same gap exists in `scripts/deploy-testnet.sh`.

> Tracked in: issue/PR TBD — add `"governance"` to both deploy scripts,
> and pass the governance contract address (not the deployer EOA) as the
> admin constructor argument for contracts that need governance-mediated
> upgrades.

### Additional known gaps

- **No proposal expiry** — a queued proposal can be executed at any point in
  the future after the timelock elapses.  There is no mechanism to invalidate
  stale proposals.
- **No emergency pause** — there is no circuit-breaker or pause function to
  halt governance execution in the event of a detected compromise.
- **No proposal description storage** — `description` is a `Symbol` (max 32
  bytes), insufficient for linking to a full proposal document or IPFS hash.

---

## Security Properties

| Property | Enforcement |
|---|---|
| Only signers can propose / vote | `require_signer()` check in `propose()`, `vote_approve()`, `vote_veto()`, `cancel()` |
| Each signer votes at most once per proposal | `DataKey::Vote(id, addr)` boolean guard |
| Threshold required for queueing | `approval_count >= threshold` → status transitions to `Queued` |
| Threshold required for rejection | `veto_count >= threshold` → status transitions to `Rejected` |
| Timelock enforced before execution | `now >= queued_at + timelock_seconds` check in `execute()` |
| Replay protection on proposals | Per-address monotonic nonce in `propose()` |
| Replay protection on execution | Per-target-contract monotonic nonce appended by `execute()` |
| Cannot vote on non-pending proposals | `status != Pending` check in `vote_approve()` / `vote_veto()` |
