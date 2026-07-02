# TODO(P2, W1): Replace with real Aurora Postgres 16 cluster.
#   - Multi-AZ, 3 instances (1 writer + 2 readers)
#   - PITR enabled, retention = var.backup_retention_days
#   - Storage encrypted with per-env KMS key
#   - Parameter group with pg_stat_statements + rls-friendly logging
#   - Enhanced monitoring + performance insights
#   - Secret rotation via Secrets Manager → Vault sync
#
# Placeholder subnet group + SG keeps module wiring intact.

resource "aws_db_subnet_group" "this" {
  name       = "${var.cluster_name}-${var.environment}-pg"
  subnet_ids = var.db_subnet_ids

  tags = {
    Name = "${var.cluster_name}-${var.environment}-pg-subnet-group"
  }
}

resource "aws_security_group" "db" {
  name        = "${var.cluster_name}-${var.environment}-db-sg"
  description = "Aurora Postgres access from EKS workers"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
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

# TODO: aws_rds_cluster + aws_rds_cluster_instance resources here
