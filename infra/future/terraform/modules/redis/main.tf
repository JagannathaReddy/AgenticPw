# TODO(P2/S1, W1): Replace with ElastiCache Redis 7 cluster.
#   - 2-node cluster mode disabled (Q1 scale)
#   - AZ multi-AZ failover on
#   - AUTH token via Secrets Manager
#   - In-transit + at-rest encryption
#   - Subnet group scoped to cache subnets (isolated)
#
# Placeholder subnet group + SG below.

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.cluster_name}-${var.environment}-cache"
  subnet_ids = var.cache_subnet_ids
}

resource "aws_security_group" "cache" {
  name        = "${var.cluster_name}-${var.environment}-cache-sg"
  description = "Redis access from EKS workers"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.eks_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# TODO: aws_elasticache_replication_group
