variable "kubeconfig_path" {
  description = "Path tới kubeconfig"
  type        = string
}

variable "deployment_name" {
  description = "Tên deployment"
  type        = string
  default     = "node-devops-upload-app"
}

variable "namespace" {
  description = "Namespace triển khai"
  type        = string
  default     = "devops"
}

variable "app_label" {
  description = "Nhãn chung cho app"
  type        = string
  default     = "node-devops-upload"
}

variable "replicas" {
  description = "Số lượng replica"
  type        = number
  default     = 1
}

variable "image_repository" {
  description = "Đường dẫn repo Docker"
  type        = string
}

variable "image_tag" {
  description = "Tag image Docker"
  type        = string
}

variable "base_dir" {
  description = "Đường dẫn mount CephFS trong container"
  type        = string
  default     = "/mnt/cephfs"
}

variable "db_host" {
  description = "Hostname hoặc ClusterIP DB"
  type        = string
  default     = "mariadb-service-clusterip.default.svc.cluster.local"
}

variable "db_port" {
  description = "Cổng DB"
  type        = string
  default     = "3306"
}

variable "cephfs_pvc_name" {
  description = "Tên PVC CephFS"
  type        = string
  default     = "cephfs-pvc"
}
