module "network" {
  source = "./modules/network"

  environment  = var.environment
  cluster_name = var.cluster_name
  vpc_cidr     = var.vpc_cidr
  azs          = var.azs
}

module "eks" {
  source = "./modules/eks"

  environment      = var.environment
  cluster_name     = var.cluster_name
  cluster_version  = var.cluster_version
  vpc_id           = module.network.vpc_id
  private_subnets  = module.network.private_subnet_ids
  browser_pool_min = var.browser_pool_min
  browser_pool_max = var.browser_pool_max
}

module "rds" {
  source = "./modules/rds"

  environment            = var.environment
  cluster_name           = var.cluster_name
  vpc_id                 = module.network.vpc_id
  db_subnet_ids          = module.network.db_subnet_ids
  eks_security_group_id  = module.eks.node_security_group_id
  instance_class         = var.postgres_instance_class
  backup_retention_days  = var.postgres_backup_retention_days
}

module "redis" {
  source = "./modules/redis"

  environment           = var.environment
  cluster_name          = var.cluster_name
  vpc_id                = module.network.vpc_id
  cache_subnet_ids      = module.network.cache_subnet_ids
  eks_security_group_id = module.eks.node_security_group_id
}

module "s3" {
  source = "./modules/s3"

  environment  = var.environment
  cluster_name = var.cluster_name
}

module "vault" {
  source = "./modules/vault"

  environment  = var.environment
  cluster_name = var.cluster_name
  eks_cluster  = module.eks.cluster_name
}
