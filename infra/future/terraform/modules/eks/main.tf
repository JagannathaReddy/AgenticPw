# TODO(S1, W1): Replace with terraform-aws-modules/eks/aws module.
#   Required config:
#   - IRSA + Pod Identity for LLM Gateway, workers, Vault agent
#   - runsc (gVisor) runtime class installed via bootstrap
#   - Three managed node groups:
#       control:  m6i.xlarge   × 3-6
#       worker:   m6i.2xlarge  × 5-15  (HPA)
#       browser:  c6i.2xlarge  × 5-30  (HPA + gVisor)
#   - Cluster autoscaler + karpenter
#   - AWS Load Balancer Controller
#   - Istio via helm (see infra/helm/)
#
# Placeholder resources below keep the module signature stable so downstream
# modules (RDS, Redis) can reference outputs without failing plan.

resource "aws_security_group" "node" {
  name        = "${var.cluster_name}-${var.environment}-node-sg"
  description = "Placeholder — EKS module will replace this"
  vpc_id      = var.vpc_id
}

# TODO: actual cluster + node group resources
