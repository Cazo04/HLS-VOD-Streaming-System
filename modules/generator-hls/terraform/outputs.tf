output "domain" {
  description = "DNS nội bộ của service (khi truy cập từ trong cluster)."
  value       = kubernetes_service.generate_hls.metadata[0].name
}

output "cluster_ip" {
  description = "Cluster IP được cấp cho service."
  value       = kubernetes_service.generate_hls.spec[0].cluster_ip
}

output "image_deployed" {
  value = "${var.image_repository}:${var.image_tag}"
}
