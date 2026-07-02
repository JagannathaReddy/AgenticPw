variable "environment" {
  type        = string
  description = "Environment name"
}

variable "cluster_name" {
  type        = string
  description = "EKS cluster name prefix"
}

variable "cluster_version" {
  type        = string
  description = "Kubernetes minor version"
}

variable "vpc_id" {
  type        = string
  description = "VPC id from network module"
}

variable "private_subnets" {
  type        = list(string)
  description = "Private subnet ids for control plane + workers"
}

variable "browser_pool_min" {
  type    = number
  default = 20
}

variable "browser_pool_max" {
  type    = number
  default = 60
}
