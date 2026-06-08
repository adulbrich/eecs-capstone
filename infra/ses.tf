# Verify the sender identity. In the SES sandbox this lets the app send to
# verified recipients; request production access later (ideally with a domain)
# to send to arbitrary addresses.
resource "aws_sesv2_email_identity" "sender" {
  email_identity = var.email_from
}
