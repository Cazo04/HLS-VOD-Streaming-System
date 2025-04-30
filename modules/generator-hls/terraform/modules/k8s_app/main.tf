locals {
  labels = {
    app = var.name
  }
}

/* --- Namespace (chỉ tạo nếu chưa có) --- */
resource "kubernetes_namespace" "this" {
  metadata {
    name = var.namespace
  }
  lifecycle {
    prevent_destroy = true      # tránh xóa nhầm namespace prod
    ignore_changes  = [metadata] # cho phép chỉnh label thủ công
  }
}

/* --- Deployment --- */
resource "kubernetes_deployment" "this" {
  metadata {
    name      = var.name
    namespace = kubernetes_namespace.this.metadata[0].name
    labels    = local.labels
  }

  spec {
    replicas = var.replicas

    selector { match_labels = local.labels }

    template {
      metadata { labels = local.labels }

      spec {
        container {
          name  = var.name
          image = var.image

          port { container_port = var.container_port }

          dynamic "env" {
            for_each = var.env
            content {
              name  = env.key
              value = env.value
            }
          }

          resources {
            limits   = var.resources.limits
            requests = var.resources.requests
          }

          liveness_probe {
            http_get {
              path = "/health"
              port = var.container_port
            }
            initial_delay_seconds = 10
            period_seconds        = 10
          }
        }
      }
    }
  }
}

/* --- Service --- */
resource "kubernetes_service" "this" {
  metadata {
    name      = var.name
    namespace = kubernetes_namespace.this.metadata[0].name
  }

  spec {
    selector = local.labels
    port {
      port        = 80
      target_port = var.container_port
      node_port   = var.service_type == "NodePort" ? var.node_port : null
    }
    type = var.service_type
  }
}
