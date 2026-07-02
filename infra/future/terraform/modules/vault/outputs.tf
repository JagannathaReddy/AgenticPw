output "unseal_kms_key_id" {
  value = aws_kms_key.vault_unseal.key_id
}

output "unseal_kms_key_arn" {
  value = aws_kms_key.vault_unseal.arn
}
