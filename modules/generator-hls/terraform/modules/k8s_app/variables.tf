variable "name" {
  type = string
}
variable "namespace" {
  type = string
}
variable "image" {
  type = string
}
variable "replicas" {
  type    = number
  default = 2
}
variable "container_port" {
  type    = number
  default = 3000
}
variable "service_type" {
  type    = string
  default = "ClusterIP"
} # ClusterIP | NodePort | LoadBalancer
variable "node_port" {
  type    = number
  default = null
} # chỉ dùng khi NodePort
variable "env" {
  type    = map(string)
  default = {}
}
variable "resources" {
  type = object({
    limits   = map(string)
    requests = map(string)
  })
  default = {
    limits   = { cpu = "500m", memory = "512Mi" }
    requests = { cpu = "250m", memory = "256Mi" }
  }
}
