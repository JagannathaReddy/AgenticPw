output "vpc_id" {
  value       = module.network.vpc_id
  description = "Platform VPC id"
}

output "private_subnet_ids" {
  value       = module.network.private_subnet_ids
  description = "Private subnet ids (workloads)"
}

output "eks_cluster_name" {
  value       = module.eks.cluster_name
  description = "EKS cluster name"
}

output "eks_cluster_endpoint" {
  value       = module.eks.cluster_endpoint
  description = "EKS API server endpoint"
  sensitive   = true
}

output "rds_writer_endpoint" {
  value       = module.rds.writer_endpoint
  description = "Aurora Postgres writer endpoint"
  sensitive   = true
}

output "redis_endpoint" {
  value       = module.redis.primary_endpoint
  description = "ElastiCache Redis primary endpoint"
  sensitive   = true
}

output "artifact_bucket" {
  value       = module.s3.artifact_bucket_name
  description = "S3 bucket for Playwright traces, videos, snapshots"
}

output "audit_bucket" {
  value       = module.s3.audit_bucket_name
  description = "S3 bucket for WORM audit log export"
}
