variable "environment" {
  description = "Environment name"
  type        = string
}

variable "cluster_name" {
  description = "Prefix used across resource names"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR for the VPC"
  type        = string
}

variable "azs" {
  description = "Availability zones to distribute across"
  type        = list(string)
  validation {
    condition     = length(var.azs) >= 3
    error_message = "At least 3 AZs required for HA"
  }
}
