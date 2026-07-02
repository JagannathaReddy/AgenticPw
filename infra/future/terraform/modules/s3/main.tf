# Two buckets: artifacts (traces, videos, snapshots) and audit (WORM export).

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${var.cluster_name}-${var.environment}-artifacts"
  force_destroy = var.environment == "dev"
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    id     = "traces-30d"
    status = "Enabled"
    filter { prefix = "traces/" }
    expiration { days = 30 }
  }
  rule {
    id     = "videos-30d"
    status = "Enabled"
    filter { prefix = "videos/" }
    expiration { days = 30 }
  }
}

# Audit bucket: Object Lock (WORM), 7-year retention
resource "aws_s3_bucket" "audit" {
  bucket              = "${var.cluster_name}-${var.environment}-audit"
  object_lock_enabled = true
  force_destroy       = false
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    default_retention {
      mode  = "COMPLIANCE"
      years = 7
    }
  }
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
