terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.29"
    }
  }
}

provider "kubernetes" {
  config_path = var.kubeconfig_path
}

resource "kubernetes_deployment" "generate_hls" {
  metadata {
    name      = var.deployment_name
    namespace = var.namespace
    labels = {
      app = var.app_label
    }
  }

  spec {
    replicas = var.replicas

    selector {
      match_labels = {
        app = var.app_label
      }
    }

    template {
      metadata {
        labels = {
          app = var.app_label
        }
      }

      spec {
        container {
          name  = "node-devops-generate-hls"
          image = "${var.image_repository}:${var.image_tag}"

          image_pull_policy = "Always"
          port {
            container_port = 3000
          }

          env {
            name  = "BASE_DIR"
            value = var.base_dir
          }
          env {
            name  = "HASH_SERVICE_URL"
            value = var.hash_service_url
          }
          env {
            name  = "DB_HOST"
            value = var.db_host
          }
          env {
            name  = "DB_PORT"
            value = var.db_port
          }

          volume_mount {
            name       = "cephfs-volume"
            mount_path = "/mnt/cephfs"
          }
        }

        volume {
          name = "cephfs-volume"
          persistent_volume_claim {
            claim_name = var.cephfs_pvc_name
          }
        }
      }
    }

    strategy {
      type = "RollingUpdate"
    }
  }
}

resource "kubernetes_service" "generate_hls" {
  metadata {
    name      = "${var.app_label}-svc"
    namespace = var.namespace
    labels = {
      app = var.app_label
    }
  }

  spec {
    selector = {
      app = var.app_label
    }
    port {
      name        = "http"
      port        = 80
      target_port = 3000
    }
    type = "ClusterIP"
  }
}
