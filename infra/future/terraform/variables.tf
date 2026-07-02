variable "environment" {
  description = "Environment name (dev|staging|prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod"
  }
}

variable "aws_region" {
  description = "Primary AWS region for this deployment"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the platform VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "azs" {
  description = "Availability zones to distribute subnets across (at least 3 for HA)"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "cluster_name" {
  description = "EKS cluster name (also used as a prefix for other resources)"
  type        = string
  default     = "test-agent"
}

variable "cluster_version" {
  description = "EKS Kubernetes version"
  type        = string
  default     = "1.30"
}

variable "browser_pool_min" {
  description = "Baseline browser pod replicas"
  type        = number
  default     = 20
}

variable "browser_pool_max" {
  description = "HPA ceiling for browser pods"
  type        = number
  default     = 60
}

variable "postgres_instance_class" {
  description = "Aurora Postgres serverless instance class"
  type        = string
  default     = "db.r6g.large"
}

variable "postgres_backup_retention_days" {
  description = "PITR retention window"
  type        = number
  default     = 30
}
