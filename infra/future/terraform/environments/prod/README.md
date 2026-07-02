# Prod environment

Placeholder — provisioned in Q1 W12 as we approach the ship gate.

Requires before apply:
- Terraform state bucket + DynamoDB lock table pre-provisioned
- KMS keys created (state, RDS, Vault unseal, S3)
- WAF web ACLs configured
- Route53 zones registered
- SOC2 boundary docs updated
- Change-management ticket approved

Override from `../dev/`:
- Multi-AZ across at least 3 AZs (mandatory)
- Larger node group sizes
- `postgres_backup_retention_days = 30`
- Cross-region S3 replication
- Non-overlapping `vpc_cidr` (e.g., `10.40.0.0/16`)
- Enable AWS Backup vault
