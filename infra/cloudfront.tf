# CloudFront reaches the private/internal ALB through a VPC origin, so the ALB
# never needs a public IP. (This resource is slow to create/destroy: 15-30+ min.)
resource "aws_cloudfront_vpc_origin" "alb" {
  vpc_origin_endpoint_config {
    name                   = "${var.project}-alb"
    arn                    = aws_lb.app.arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "http-only"

    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }

  tags = { Name = "${var.project}-alb-vpc-origin" }
}

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "${var.project}-assets-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Read-only on purpose. The certificate is DNS-validated against a record in
# the OSU-managed eecs.oregonstate.edu zone, so re-issuing it costs a support
# ticket. A data source can never destroy it; an imported resource could.
# See DEPLOYMENT.md section 3.7 for the records OSU holds. `most_recent` picks
# silently if this shared account ever holds two certs for the same domain;
# that is tolerable here because any such cert covers the same hostname.
data "aws_acm_certificate" "app" {
  provider    = aws.us_east_1
  domain      = var.certificate_domain
  statuses    = ["ISSUED"]
  most_recent = true
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

# App distribution: dynamic SSR origin (the ALB via VPC origin). On the
# default behavior, caching is disabled and all viewer headers/cookies/query
# are forwarded. A separate ordered_cache_behavior below caches /assets/* on
# Managed-CachingOptimized; never widen that path_pattern beyond hashed build
# output, since CachingOptimized's one-second minimum TTL caches even when
# the origin sends no-cache.
resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  comment         = "${var.project} app"
  is_ipv6_enabled = true
  aliases         = [var.domain_name]

  origin {
    domain_name = aws_lb.app.dns_name
    origin_id   = "alb"

    vpc_origin_config {
      vpc_origin_id = aws_cloudfront_vpc_origin.alb.id
    }
  }

  default_cache_behavior {
    target_origin_id         = "alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # Hashed build output only. Managed-CachingOptimized enables gzip and brotli
  # in the cache key, which Managed-CachingDisabled on the default behavior
  # does not, so `compress` is a no-op there. In practice the origin already
  # returns Content-Encoding (see compressPublicAssets in vite.config.ts) and
  # CloudFront forwards that untouched; `compress` here is the fallback.
  #
  # Deliberately no origin_request_policy_id. CloudFront then forwards the
  # minimum and rewrites Host to the origin domain, which is safe because the
  # ALB listener (infra/ecs.tf:30) forwards unconditionally to one target group
  # with no host-header conditions and Nitro's static handler never reads Host.
  # Do not copy Managed-AllViewer from the default behavior: forwarding every
  # cookie on a behavior whose purpose is to avoid the origin is pure overhead.
  #
  # Never widen this path_pattern. CachingOptimized has a 1s minimum TTL, which
  # caches even when the origin sends no-cache, no-store, or private. Harmless
  # for content-hashed files, a signed-in-response leak on any auth-dependent
  # path.
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.app.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = { Name = "${var.project}-app" }
}

# Assets distribution: private S3 origin via OAC, caching enabled.
resource "aws_cloudfront_distribution" "assets" {
  enabled         = true
  comment         = "${var.project} assets"
  is_ipv6_enabled = true

  origin {
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id                = "s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  default_cache_behavior {
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Name = "${var.project}-assets" }
}
