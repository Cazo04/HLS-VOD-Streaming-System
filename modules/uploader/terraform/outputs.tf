output "cluster_ip" {
  description = "ClusterIP của service"
  value       = kubernetes_service.upload.spec[0].cluster_ip
}

output "domain" {
  description = "Nếu có Ingress riêng bạn có thể map tới tên này"
  value       = kubernetes_service.upload.metadata[0].name
}

output "image_deployed" {
  description = "Image đã triển khai"
  value       = "${var.image_repository}:${var.image_tag}"
}
