variable "kubeconfig_path" {
  description = "Đường dẫn kubeconfig (được Jenkins đặt qua biến KUBECONFIG)."
  type        = string
}

variable "namespace" {
  description = "Namespace để deploy."
  type        = string
  default     = "default"
}

variable "deployment_name" {
  type    = string
  default = "node-devops-generate-hls-app"
}

variable "app_label" {
  type    = string
  default = "node-devops-generate-hls"
}

variable "replicas" {
  type    = number
  default = 1
}

variable "image_repository" {
  type    = string
  default = "192.168.5.10/devops/generator-hls"
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "cephfs_pvc_name" {
  type    = string
  default = "cephfs-pvc"
}

variable "base_dir"        { 
    type = string 
    default = "/mnt/cephfs/completed" 
}
variable "hash_service_url"{ 
    type = string 
    default = "http://node-hash-service-clusterip:3000/hash/" 
}
variable "db_host"         { 
    type = string 
    default = "mariadb-service-clusterip.default.svc.cluster.local" 
}
variable "db_port"         { 
    type = string 
    default = "3306" 
}
