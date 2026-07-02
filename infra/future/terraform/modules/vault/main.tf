# TODO(S1, W1):
#   - Provision Vault Enterprise cluster (in-cluster HA via Helm, auto-unseal
#     via AWS KMS)
#   - Enable Kubernetes auth backend against var.eks_cluster
#   - Enable audit backend to S3 (see modules/s3/audit)
#   - Configure secret paths:
#       secret/tenants/<workspace_id>/*   – customer credentials
#       secret/github/<installation_id>   – short-lived app tokens
#       secret/llm/anthropic              – provider API keys
#       secret/llm/openai                 – provider API keys
#   - Define policies matching Q1 access needs
#   - Bootstrap root token → seal + rotate → store in AWS Secrets Manager
#
# This module intentionally leaves Vault to be provisioned via Helm chart on
# EKS (not Terraform-managed cluster nodes) because Vault's own state should
# not depend on Terraform state.

resource "aws_kms_key" "vault_unseal" {
  description             = "Vault auto-unseal key (${var.environment})"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "${var.cluster_name}-${var.environment}-vault-unseal"
  }
}

resource "aws_kms_alias" "vault_unseal" {
  name          = "alias/${var.cluster_name}-${var.environment}-vault-unseal"
  target_key_id = aws_kms_key.vault_unseal.key_id
}
