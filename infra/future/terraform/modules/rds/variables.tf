variable "environment" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "db_subnet_ids" {
  type        = list(string)
  description = "Subnets for the DB subnet group (isolated)"
}

variable "eks_security_group_id" {
  type        = string
  description = "Grant DB access to this SG"
}

variable "instance_class" {
  type        = string
  description = "Aurora Postgres instance class"
}

variable "backup_retention_days" {
  type    = number
  default = 30
}
