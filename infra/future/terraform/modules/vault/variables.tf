variable "environment" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "eks_cluster" {
  type        = string
  description = "EKS cluster name to enable Kubernetes auth for"
}
