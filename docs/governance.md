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

## Admin Key Rotation

Admin keys are expected to be HSM-held operational keys controlled by governance. Rotation is performed by queuing the target contract call through the governance timelock, reviewing the destination address, then having the current admin execute `set_admin`. After rotation, admin-gated functions reject the old address and accept the new address.
