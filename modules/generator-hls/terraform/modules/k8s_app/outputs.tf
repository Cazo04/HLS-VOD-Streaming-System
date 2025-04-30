output "service_ip" {
  value       = kubernetes_service.this.status[0].load_balancer[0].ingress[0].ip
  description = "IP hoặc hostname của Service (chỉ LoadBalancer)"
  sensitive   = false
}
output "node_port" {
  value = var.service_type == "NodePort" ? kubernetes_service.this.spec[0].port[0].node_port : null
  description = "The node port of the service (only for NodePort service type)"
}
