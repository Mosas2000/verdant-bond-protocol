# Governance

## Admin Control Model

The Verdant Bond Protocol uses a **3-of-5 multisig + 48-hour timelock** governance model to control all critical contract administration functions.

### Deployment Architecture

1. **Governance Contract** is deployed first with an externally-owned account (EOA) admin for initial setup
2. **Operational Contracts** are deployed with the Governance contract address set as their admin:
   - `ProjectRegistry` — project approval/rejection
   - `BondIssuer` — bond configuration and maturity control
   - `CouponEngine` — coupon distribution parameters
   - `OracleConsumer` — oracle provider management and configuration
   - `DEXRouter` — order management
   - `CreditRetirement` — retirement transaction oversight

### Admin Rotation

Every operational contract includes public `set_admin(current_admin, new_admin, nonce)` and `get_admin()` functions. This enables:

- **Initial transition**: EOA admin can rotate Governance's own admin to itself (or a multisig account) after governance signers are configured
- **Runtime rotation**: Any contract admin can be rotated to a new address via multisig proposal + timelock execution
- **Nonce protection**: Each admin rotation consumes a unique nonce to prevent replay attacks

### Multi-Stakeholder Committee

Governance signers represent:

- Project Developers
- Bond Issuers
- Oracle Providers
- Protocol Maintainers
- Token Holders

### Governance Actions (3-of-5 Multi-sig + 48h Timelock)

Any contract admin action that requires governance approval must go through:

1. **Proposal Creation** — A signer submits a proposal to invoke a target contract method with specific arguments
2. **Voting Window** — Signers vote to approve or veto (3-of-5 threshold)
   - 3 approvals → Proposal queued
   - 3 vetoes → Proposal rejected
3. **Timelock Delay** — Approved proposals enter a 48-hour cooldown
4. **Execution** — After 48 hours, any account may execute the approved proposal

This design ensures all admin changes are:

- **Transparent** — Proposed and voted on-chain
- **Time-locked** — Community has 48 hours to respond
- **Multisig-protected** — Requires consensus of 3-of-5 signers

### Supported Governance Actions

Via `Governance.execute()` after proposal passes multisig + timelock:

- Add/remove oracle providers → `OracleConsumer.register_provider()` / `remove_provider()`
- Update credit conversion factors → `CouponEngine` configuration (if exposed as admin function)
- Rotate any contract's admin → `{Contract}.set_admin()`
- Modify KYC requirements → `ProjectRegistry` configuration (if exposed as admin function)
- Adjust dispute resolution parameters → `OracleConsumer` configuration

### Deployment Verification

The deployment scripts (`scripts/deploy-mainnet.sh`, `scripts/deploy-testnet.sh`) include a post-deployment verification step that confirms each operational contract's stored admin matches the deployed Governance contract address.
