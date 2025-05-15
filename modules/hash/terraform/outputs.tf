output "cluster_ip" {
  description = "ClusterIP của service"
  value       = kubernetes_service.hash.spec[0].cluster_ip
}

output "domain" {
  description = "Tên service (dùng nội bộ cluster hoặc map Ingress)"
  value       = kubernetes_service.hash.metadata[0].name
}

output "image_deployed" {
  description = "Image đã deploy"
  value       = "${var.image_repository}:${var.image_tag}"
}
