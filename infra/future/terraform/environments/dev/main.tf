# Dev environment composition. Pulls the root module and passes env-specific
# values from terraform.tfvars.

module "platform" {
  source = "../.."

  environment = "dev"
  aws_region  = "us-east-1"

  vpc_cidr = "10.20.0.0/16"
  azs      = ["us-east-1a", "us-east-1b", "us-east-1c"]

  cluster_name    = "test-agent"
  cluster_version = "1.30"

  browser_pool_min = 5
  browser_pool_max = 20

  postgres_instance_class        = "db.r6g.large"
  postgres_backup_retention_days = 7
}

output "vpc_id" {
  value = module.platform.vpc_id
}

output "artifact_bucket" {
  value = module.platform.artifact_bucket
}
