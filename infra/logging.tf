# Access logs for the ALB and the app distribution. Nothing recorded what
# actually happened before this: CloudWatch metrics answer "how many 4XX this
# hour" and never "which request, from where, to what path, with what status",
# which is why #519's blast radius and the 2026-09-17 spike are permanently
# unknowable (#523).
#
# These logs hold the full client IP of every visitor, which is a different
# decision from the one the traffic collector made for itself in #508, where
# the address is hashed and never stored. Operational logs keeping raw
# addresses is ordinary, and the control is the retention rule below rather
# than the collection. See ADR-0036.

resource "aws_s3_bucket" "access_logs" {
  bucket = "${var.project}-access-logs-${data.aws_caller_identity.current.account_id}"

  tags = { Name = "${var.project}-access-logs" }
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# SSE-S3 rather than a KMS key on purpose: ALB access logging supports only
# S3-managed keys, and a bucket the ALB cannot write to is a silent failure.
resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The retention rule is the privacy control, so it deletes rather than
# transitions to cheaper storage: a visitor address moved to Glacier is still
# a visitor address. Thirty days matches the CloudWatch log group.
resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.access_log_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# us-west-2 predates the service-principal form of ALB log delivery, so the
# grant goes to the regional ELB account rather than to a service. The data
# source is what keeps that account id out of this file.
data "aws_elb_service_account" "main" {}

data "aws_iam_policy_document" "access_logs" {
  statement {
    sid       = "AllowALBAccessLogs"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.access_logs.arn}/alb/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]

    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.main.arn]
    }
  }

  # CloudFront standard logging v2 delivers as the vended-logs service rather
  # than as an account, and the source conditions are what stop another
  # account naming this bucket as its own log destination.
  statement {
    sid       = "AllowCloudFrontLogDelivery"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.access_logs.arn}/cloudfront/*"]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:*"]
    }
  }
}

resource "aws_s3_bucket_policy" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  policy = data.aws_iam_policy_document.access_logs.json
}

# CloudFront standard logging, version 2. The older `logging_config` block on
# the distribution is the obvious thing to reach for and is not used here: it
# requires the destination bucket to have ACLs enabled and to grant the
# awslogsdelivery account FULL_CONTROL, which means turning off
# `BucketOwnerEnforced` on a bucket holding visitor addresses. v2 delivers
# under a bucket policy instead, so the bucket above keeps ACLs disabled.
#
# CloudFront is global and its delivery source must be created in us-east-1,
# which is why these three carry the aliased provider the ACM certificate
# already uses. The bucket itself stays in us-west-2.
resource "aws_cloudwatch_log_delivery_source" "cloudfront_app" {
  provider = aws.us_east_1

  name         = "${var.project}-app-access-logs"
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.app.arn

  tags = { Name = "${var.project}-app-access-logs" }
}

resource "aws_cloudwatch_log_delivery_destination" "access_logs_s3" {
  provider = aws.us_east_1

  name          = "${var.project}-access-logs-s3"
  output_format = "json"

  delivery_destination_configuration {
    destination_resource_arn = aws_s3_bucket.access_logs.arn
  }

  tags = { Name = "${var.project}-access-logs-s3" }
}

resource "aws_cloudwatch_log_delivery" "cloudfront_app" {
  provider = aws.us_east_1

  delivery_source_name     = aws_cloudwatch_log_delivery_source.cloudfront_app.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.access_logs_s3.arn

  s3_delivery_configuration {
    suffix_path                 = "/cloudfront"
    enable_hive_compatible_path = false
  }

  tags = { Name = "${var.project}-app-access-logs" }
}
