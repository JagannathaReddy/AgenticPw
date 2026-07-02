terraform {
  backend "s3" {
    bucket         = "test-agent-tfstate-dev"
    key            = "platform/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    kms_key_id     = "alias/terraform-state"
    dynamodb_table = "test-agent-tfstate-dev-lock"
  }
}
