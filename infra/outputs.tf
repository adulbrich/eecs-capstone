output "app_url" {
  description = "Public HTTPS URL of the app (set as the GitHub OAuth callback host)."
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
}

output "assets_url" {
  description = "Public HTTPS base URL for uploaded assets (VITE_STORAGE_PUBLIC_BASE)."
  value       = "https://${aws_cloudfront_distribution.assets.domain_name}"
}

output "ecr_repository_url" {
  description = "ECR repository the deploy workflow pushes images to."
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service" {
  value = aws_ecs_service.app.name
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

output "github_deploy_role_arn" {
  description = "IAM role the GitHub Actions deploy workflow assumes via OIDC."
  value       = aws_iam_role.github_deploy.arn
}
