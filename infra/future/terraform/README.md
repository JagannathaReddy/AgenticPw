# Terraform — infra as code

Root Terraform layout for the Q1 platform. Managed via **GitOps** (Argo CD) — direct `terraform apply` is only for the bootstrap.

## Layout

```
infra/terraform/
├── README.md                   ← you are here
├── versions.tf                 ← provider version pins
├── providers.tf                ← AWS provider config
├── variables.tf                ← root-level knobs
├── main.tf                     ← composes modules per env
├── outputs.tf                  ← what the root exposes
├── environments/
│   ├── dev/
│   │   ├── backend.tf
│   │   ├── terraform.tfvars
│   │   └── main.tf             ← env-specific overrides
│   ├── staging/
│   └── prod/
└── modules/
    ├── network/                ← VPC, subnets, NAT, endpoints (real)
    ├── eks/                    ← cluster + node pools (stub)
    ├── rds/                    ← Aurora Postgres (stub)
    ├── redis/                  ← ElastiCache (stub)
    ├── s3/                     ← artifact buckets (stub)
    └── vault/                  ← Vault namespace (stub)
```

## What ships in Q1

Real modules: **network**. Everything else has a stub with well-formed variables + outputs so the composition compiles and the pattern is clear; implementation happens week 1 by S1 following this scaffold.

## First-time bootstrap

```bash
# Assume the terraform-admin IAM role
aws sts assume-role --role-arn arn:aws:iam::<account>:role/terraform-admin ...

# Initialize dev
cd infra/terraform/environments/dev
terraform init -backend-config=backend.tf
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

## State management

- **State backend:** S3 + DynamoDB for state locking (per env)
- **State encryption:** SSE-KMS with the `terraform-state` CMK
- **Access:** only the `terraform-admin` and `terraform-reader` roles

Never commit `.tfstate` files. `.gitignore` already covers them.

## Module conventions

Every module exposes:
- `variables.tf` — inputs with types and descriptions
- `main.tf` — resources
- `outputs.tf` — everything downstream modules or apps consume
- `versions.tf` — module-level pin
- `README.md` — inputs/outputs table + example usage

## Change process

1. Open PR with `terraform plan` output attached
2. Two approvals (one from S1, one from any eng)
3. `terraform apply` runs via CI (dev auto, staging/prod gated on manual approval)
4. Drift detection runs nightly; alerts on unmatched plan

## What NOT to put in Terraform

- **Secrets** → Vault (Terraform can read Vault via provider; never store cleartext)
- **App config** → env-specific ConfigMaps in K8s manifests, not TF
- **DNS records for ephemeral envs** → external-dns operator, not TF
