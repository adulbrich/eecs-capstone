# Outbound email. The identity is a domain rather than a single address on
# purpose: SES verifies an address identity by emailing it a confirmation link
# that someone has to click, and `noreply@` has no mailbox to receive it.
#
# Applying this resource is what generates the DKIM tokens; the domain stays
# unverified until OSU publishes the three CNAMEs it produces. See
# DEPLOYMENT.md section 9.
resource "aws_sesv2_email_identity" "app" {
  email_identity = var.domain_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  tags = { Name = "${var.project}-email" }
}

# oregonstate.edu publishes `p=reject` with no `sp=`, and RFC 7489 policy
# discovery falls back from an absent `_dmarc.capstone.eecs.oregonstate.edu`
# straight to the organizational domain, skipping the `p=none` on
# eecs.oregonstate.edu. Treat DKIM alignment as mandatory: unaligned mail is
# rejected outright rather than spam-foldered.
output "ses_dkim_records" {
  description = "CNAMEs OSU must publish before the domain will verify. Each name is <token>._domainkey.<domain>; each value is <token>.dkim.amazonses.com."
  value = [
    for token in aws_sesv2_email_identity.app.dkim_signing_attributes[0].tokens :
    {
      name  = "${token}._domainkey.${var.domain_name}"
      value = "${token}.dkim.amazonses.com"
    }
  ]
}

output "ses_verification_status" {
  description = "PENDING until the DKIM CNAMEs resolve; SUCCESS once SES has checked them."
  value       = aws_sesv2_email_identity.app.dkim_signing_attributes[0].status
}
