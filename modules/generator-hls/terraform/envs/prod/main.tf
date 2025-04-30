provider "kubernetes" {
  config_path = pathexpand("${path.module}/kubeconfig-prod")
}

module "node_api" {
  source         = "../../modules/k8s_app"
  name           = "node-api"
  namespace      = "prod"
  image          = "registry.example.com/project/node-api:${var.image_tag}"
  replicas       = 3
  service_type   = "LoadBalancer"     # hoặc "ClusterIP" & dùng Ingress Gateway
  env            = { NODE_ENV = "production" }
}
