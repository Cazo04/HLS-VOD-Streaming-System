resource "proxmox_vm_qemu" "clones" {
    for_each = {
        for vm in var.clones : vm.name => vm
    }

    name        = each.value.name
    vmid        = each.value.vmid
    target_node = each.value.node

    # Clone from template
    clone   = var.template_id
    storage = each.value.storage

    # Basic configuration
    cores   = each.value.cores
    sockets = 1
    memory  = each.value.memory
    onboot  = each.value.onboot

    # Network configuration
    network {
        model   = each.value.network_model
        bridge  = each.value.network_bridge
        tag     = each.value.network_vlan
        macaddr = each.value.network_mac == "auto" ? null : each.value.network_mac
        # Note: "auto" → can be set to null to let Proxmox automatically assign MAC
    }

    # Disk configuration
    disk {
        size    = each.value.disk_size
        type    = each.value.disk_type
        storage = each.value.storage
        ssd     = each.value.ssd_emulation
    }
}

resource "kubernetes_manifest" "rook_operator" {
    manifest = yamldecode(file("${path.module}/../apps/rook/operator.yaml"))
}

resource "kubernetes_manifest" "rook_crds" {
    manifest = yamldecode(file("${path.module}/../apps/rook/crds.yaml"))
}

resource "kubernetes_manifest" "rook_common" {
    manifest = yamldecode(file("${path.module}/../apps/rook/common.yaml"))
}

resource "kubernetes_manifest" "rook_cluster" {
    manifest = yamldecode(file("${path.module}/../apps/rook/cluster.yaml"))
    depends_on = [ kubernetes_manifest.rook_common, kubernetes_manifest.rook_crds, kubernetes_manifest.rook_operator ]
}

resource "kubernetes_manifest" "rook_cephfs" {
    manifest = yamldecode(file("${path.module}/../apps/rook/cephfs.yaml"))
    depends_on = [ kubernetes_manifest.rook_cluster ]
}

resource "kubernetes_manifest" "rook_storageclass" {
    manifest = yamldecode(file("${path.module}/../apps/rook/storageclass.yaml"))
    depends_on = [ kubernetes_manifest.rook_cephfs ]
}

resource "kubernetes_manifest" "rook_pvc" {
    manifest = yamldecode(file("${path.module}/../apps/rook/pvc.yaml"))
    depends_on = [ kubernetes_manifest.rook_storageclass ]
}

resource "kubernetes_manifest" "mariadb_pvc" {
    manifest = yamldecode(file("${path.module}/../apps/mariadb/pvc.yaml"))
    depends_on = [ kubernetes_manifest.rook_storageclass ]
}

resource "kubernetes_manifest" "mariadb_deployment" {
    manifest = yamldecode(file("${path.module}/../apps/mariadb/deployment.yaml"))
    depends_on = [ kubernetes_manifest.rook_pvc, kubernetes_manifest.mariadb_pvc ]
}

resource "kubernetes_manifest" "mariadb_service" {
    manifest = yamldecode(file("${path.module}/../apps/mariadb/service.yaml"))
}

resource "kubernetes_config_map" "nginx_conf" {
    metadata {
        name = "nginx-conf"
    }

    data = {
        "nginx.conf" = file("${path.module}/../apps/nginx/default.conf")
    }
}

resource "kubernetes_deployment" "nginx" {
    metadata {
        name = "nginx"
    }

    spec {
        replicas = 2

        selector {
            match_labels = {
                app = "nginx"
            }
        }

        template {
            metadata {
                labels = {
                    app = "nginx"
                }
                
                annotations = {
                    "checksum/config" = sha1(kubernetes_config_map.nginx_conf.data["nginx.conf"])
                }
            }

            spec {
                container {
                    name  = "nginx"
                    image = "nginx:latest"

                    volume_mount {
                        name      = "nginx-conf"
                        mount_path = "/etc/nginx/conf.d/default.conf"
                        sub_path   = "nginx.conf"
                    }
                }

                volume {
                    name = "nginx-conf"

                    config_map {
                        name = kubernetes_config_map.nginx_conf.metadata[0].name
                    }
                }
            }
        }
    }
}