# Dev-specific values that don't belong in main.tf (secrets refs, override
# knobs). Keep this file free of actual secrets — only references to Vault
# paths and Secrets Manager IDs.

# example:
# workos_client_id_ref = "aws-sm://test-agent-dev/workos/client-id"
