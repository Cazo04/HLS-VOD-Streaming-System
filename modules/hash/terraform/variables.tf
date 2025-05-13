variable "kubeconfig_path" {
  description = "Đường dẫn kubeconfig cho provider Kubernetes"
  type        = string
}

variable "deployment_name" {
  description = "Tên deployment"
  type        = string
  default     = "node-devops-hash-app"
}

variable "namespace" {
  description = "Namespace triển khai"
  type        = string
  default     = "default"
}

variable "app_label" {
  description = "Nhãn app chung"
  type        = string
  default     = "node-devops-hash"
}

variable "replicas" {
  description = "Số replica"
  type        = number
  default     = 1
}

variable "image_repository" {
  description = "Docker repo"
  type        = string
}

variable "image_tag" {
  description = "Tag image"
  type        = string
}

variable "base_dir" {
  description = "Đường dẫn CephFS mount trong container"
  type        = string
  default     = "/mnt/cephfs"
}

variable "db_host" {
  description = "Địa chỉ dịch vụ MariaDB"
  type        = string
  default     = "mariadb-service-clusterip.default.svc.cluster.local"
}

variable "db_port" {
  description = "Cổng MariaDB"
  type        = string
  default     = "3306"
}

variable "cephfs_pvc_name" {
  description = "Tên PVC CephFS"
  type        = string
  default     = "cephfs-pvc"
}
