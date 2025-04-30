provider "kubernetes" {
  config_path = pathexpand("~/.kube/config")   # dev cluster local
}

module "node_api" {
  source         = "../../modules/k8s_app"
  name           = "generator-hls"
  namespace      = "dev"
  image          = "192.168.5.10/devops/generator-hls:${var.image_tag}"
  replicas       = 1
  service_type   = "NodePort"
  node_port      = 30080
  env            = { NODE_ENV = "development" }
}
