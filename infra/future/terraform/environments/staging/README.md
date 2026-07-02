# Staging environment

Placeholder — provisioned in Q1 W8 as design partners graduate from dev.

Copy `../dev/` as the starting template. Override:
- Larger EKS node counts
- `postgres_backup_retention_days = 14`
- Separate state bucket + KMS key
- Different `vpc_cidr` (e.g., `10.30.0.0/16`) to avoid overlap in future VPC peering
