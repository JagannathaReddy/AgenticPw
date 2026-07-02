output "artifact_bucket_name" {
  value = aws_s3_bucket.artifacts.id
}

output "artifact_bucket_arn" {
  value = aws_s3_bucket.artifacts.arn
}

output "audit_bucket_name" {
  value = aws_s3_bucket.audit.id
}

output "audit_bucket_arn" {
  value = aws_s3_bucket.audit.arn
}
