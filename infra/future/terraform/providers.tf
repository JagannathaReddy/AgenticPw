provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "test-agent"
      ManagedBy   = "terraform"
      Owner       = "platform-eng"
    }
  }
}

# EKS providers are configured in environments/<env>/main.tf after the EKS
# module runs, so kubeconfig can be derived from the cluster output.
