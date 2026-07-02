output "writer_endpoint" {
  value       = "TODO-writer.rds.amazonaws.com"
  description = "Aurora writer endpoint (placeholder)"
}

output "reader_endpoint" {
  value       = "TODO-reader.rds.amazonaws.com"
  description = "Aurora reader endpoint (placeholder)"
}

output "db_security_group_id" {
  value = aws_security_group.db.id
}

output "subnet_group_name" {
  value = aws_db_subnet_group.this.name
}
