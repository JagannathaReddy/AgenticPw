# Network module

Multi-AZ VPC with segmented subnets for workloads, database, and cache. Includes NAT per AZ for HA and interface + gateway endpoints for ECR and S3 to reduce NAT egress cost.

## Inputs

| Name | Type | Description |
|------|------|-------------|
| `environment` | string | dev / staging / prod |
| `cluster_name` | string | Resource name prefix |
| `vpc_cidr` | string | CIDR block for VPC |
| `azs` | list(string) | At least 3 AZs |

## Outputs

| Name | Description |
|------|-------------|
| `vpc_id` | VPC id |
| `vpc_cidr` | VPC CIDR |
| `public_subnet_ids` | Public subnet ids (for load balancers) |
| `private_subnet_ids` | Private subnet ids (for EKS workloads) |
| `db_subnet_ids` | Isolated DB subnet ids |
| `cache_subnet_ids` | Isolated cache subnet ids |
| `nat_gateway_ids` | Per-AZ NAT gateway ids |

## Subnet allocation

Given `vpc_cidr = 10.20.0.0/16`:

| Purpose | Prefix | Per-AZ size |
|---------|--------|-------------|
| Public | /20 | ~4k IPs |
| Private (workloads) | /20 | ~4k IPs |
| DB | /24 | 256 IPs |
| Cache | /24 | 256 IPs |

Tune per environment via `vpc_cidr` if you need larger address space.

## Endpoints

- **S3 gateway endpoint** — free, avoids NAT for artifact uploads
- **ECR API + ECR Docker interface endpoints** — image pulls stay inside VPC

Additional endpoints (STS, Secrets Manager, KMS) added in later PRs as we adopt those services.
