# Governance

## Multi-Stakeholder Committee

- Project Developers
- Bond Issuers
- Oracle Providers
- Protocol Maintainers
- Token Holders

## Governance Actions (3-of-5 Multi-sig)

- Add/remove oracle providers
- Rotate BondIssuer, OracleConsumer, and DEXRouter admin keys via each contract's `set_admin(current_admin, new_admin)` entrypoint
- Update credit conversion factors
- Deploy contract upgrades (48h timelock)
- Modify KYC requirements
- Adjust dispute resolution parameters

## Proposal Authorization & Allow-List

### Threat Model

Once the Governance contract is wired up as the admin for protocol contracts, a compromised or colluding 3-of-5 multisig could propose arbitrary admin-only function invocations on any contract that trusts the Governance address. Examples of dangerous actions:

- Slashing an arbitrary oracle provider with no cause
- Setting oracle signature threshold to 0 (bypassing verification)
- Transferring admin to an attacker's address
- Invoking unauthorized fund transfers or state mutations

### Mitigation: Method Allow-List

The Governance contract maintains an explicit allow-list of **(target_contract, method_name)** pairs that proposals are permitted to invoke:

1. **Initialization**: The allow-list is bootstrapped as **empty** at contract construction
2. **Explicit Approval**: Only methods explicitly added to the allow-list via `add_to_allow_list(target, method)` can be proposed
3. **Authorization**: `add_to_allow_list` and `remove_from_allow_list` require signer authorization (must be called by a signer with valid nonce)
4. **Enforcement**: `propose()` rejects any (target, method) pair not in the allow-list with `Unauthorized` error
5. **Dynamic Updates**: The allow-list can be updated via governance proposals, allowing the protocol to evolve while maintaining the authorization layer

### Example Safe Allow-List

```
// Initial safe list (must be added via add_to_allow_list before any proposals)
- (BondIssuer, "set_admin")
- (OracleConsumer, "set_admin")
- (OracleConsumer, "set_signature_threshold")
- (OracleConsumer, "set_minimum_verifier_stake")
- (DEXRouter, "set_admin")

// Dangerous methods NEVER added:
- (OracleConsumer, "slash_provider")  // no direct slashing via governance
- (BondIssuer, "transfer")             // no direct token transfers
- (BondIssuer, "fund_redemption")      // only admin-callable via proposal, must be explicit
```

### Governance Flow with Allow-List

1. **Signer proposes** `propose(target, method, args, ...)`
   - Signer must be in signers list
   - Check: Is (target, method) in allow-list?
   - If not → rejected with `Unauthorized`
   - If yes → proceed to voting

2. **Multisig votes**
   - 3-of-5 approval required
   - Voting proceeds normally

3. **Timelock elapses**
   - 48 hours passes

4. **Execute**
   - `execute(proposal_id, ...)` calls target.method(args) with governance as caller

### Adding New Methods to Allow-List

To extend the allow-list (e.g., to enable new governance actions):

```
// Before any new proposals can use the method:
1. Signer calls: add_to_allow_list(new_target, new_method, nonce)
2. Method is added to allow-list
3. Now proposals using (new_target, new_method) are permitted
```

This ensures that even if multisig is compromised, attackers cannot propose arbitrary actions—only those explicitly pre-approved by the governance protocol.

## Admin Key Rotation

Admin keys are expected to be HSM-held operational keys controlled by governance. Rotation is performed by queuing the target contract call through the governance timelock, reviewing the destination address, then having the current admin execute `set_admin`. After rotation, admin-gated functions reject the old address and accept the new address.

## Proposal Validation & Pre-Flight Checks

### On-Chain Validation (Limited)

The smart contract's `propose()` function accepts target/method/args with **permissive** validation:

- Proposals are accepted as long as they are structurally sound (nonce, signer check, etc.)
- **No full validation** of contract address existence or method signatures happens on-chain
- Invalid or malformed proposals will fail during `execute()` after the full voting cycle and timelock

### Why Limited On-Chain Validation?

Soroban lacks runtime contract interface introspection, making it impossible to validate method signatures or argument types on-chain before execution. Full validation requires client-side simulation.

### Best Practice: Client-Side Pre-Flight Checks

**Before submitting a proposal, the API/governance UI MUST:**

1. **Verify target contract exists** - Check that the contract address is deployed on the network
2. **Simulate the call** - Invoke the target method with the proposed arguments in a simulated/test environment (e.g., `soroban contract simulate` or test harness)
3. **Validate argument types** - Ensure all arguments match the target method's expected signature
4. **Document the proposal** - Include the call schema and expected behavior in proposal metadata

### Example Pre-Flight Flow

```
Frontend → API
  ↓
API: Parse proposal JSON (target, method, args)
  ↓
API: Check that target contract is deployed
  ↓
API: Call soroban contract simulate or local test environment
  ↓
API: If simulation succeeds → allow propose() submission
     If simulation fails → reject with helpful error message (contract not found, method invalid, args mismatch, etc.)
  ↓
Frontend: Display validation result to user
```

### Failure Scenarios

| Scenario                       | Detected                      | Action                                              |
| ------------------------------ | ----------------------------- | --------------------------------------------------- |
| Contract address typo          | Pre-flight (client)           | Reject before propose()                             |
| Method name typo               | Pre-flight (client)           | Reject before propose()                             |
| Wrong argument count/types     | Pre-flight (client)           | Reject before propose()                             |
| Auth failure (state-dependent) | Pre-flight (client)           | May succeed if state allows; will fail at execute() |
| Logic error in target method   | Execute time (after timelock) | Proposal fails after 48h + voting                   |

### Documentation Requirement

Critical governance proposals (e.g., contract upgrades, admin rotation) SHOULD include:

- Target contract address and version
- Method name and full argument list
- Expected behavior and any state assumptions
- Pre-flight test results confirming the call is valid

This allows reviewers to verify the proposal independently before voting.
