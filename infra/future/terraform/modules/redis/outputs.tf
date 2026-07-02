output "primary_endpoint" {
  value       = "TODO.cache.amazonaws.com"
  description = "Redis primary endpoint (placeholder)"
}

output "security_group_id" {
  value = aws_security_group.cache.id
}
