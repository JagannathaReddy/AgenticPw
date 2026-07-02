variable "environment" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "cache_subnet_ids" {
  type = list(string)
}

variable "eks_security_group_id" {
  type = string
}
