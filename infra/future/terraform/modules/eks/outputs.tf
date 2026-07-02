output "cluster_name" {
  value       = "${var.cluster_name}-${var.environment}"
  description = "EKS cluster name (placeholder — real name comes from cluster resource)"
}

output "cluster_endpoint" {
  value       = "https://TODO.eks.amazonaws.com"
  description = "EKS API endpoint (placeholder)"
}

output "node_security_group_id" {
  value = aws_security_group.node.id
}

# TODO(S1): add cluster_ca, oidc_provider_arn, node_role_arn once real cluster ships
