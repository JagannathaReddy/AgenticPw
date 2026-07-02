# Future infra — parked, not deleted

Everything here is the **cloud target** for when this project graduates from local development. It's not on the Q1 critical path.

- `terraform/` — full AWS-hosted architecture (EKS, RDS Aurora, ElastiCache, S3, Vault, VPC endpoints, per-AZ NAT)

## Why it's parked

The design is right; the sequencing was wrong. Local first, cloud second. Once the platform runs end-to-end on a laptop against real Playwright repos and real LLMs, we bring these back and light them up region by region.

## When to un-park

Trigger to move a module out of `future/` and into an actively deployed layout:

- **network + eks + rds** — when we have a first paying customer or a design partner requiring hosted deployment
- **redis + s3 + vault** — same trigger as EKS
- **multi-region + DR modules** — when we have a customer with a data-residency requirement

## What still applies locally

Even while parked, the Terraform docs and module signatures are the **contract we're building toward.** Local implementations should match the same interface (e.g., `interface ArtifactStore` implementations swap between local FS and S3 with no code changes elsewhere).

The Q1 tech design doc treats these as the destination; the local README treats them as "not now."
