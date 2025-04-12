pm_api_url      = "https://192.168.4.10:8006/api2/json"
pm_user         = "root@pam"
pm_password     = ""
pm_tls_insecure = true

template_id     = "145"

clones = [
  {
    name            = "k8s-master"
    vmid            = 160
    node            = "work1"
    storage         = "pve1-nvme-1"
    cores           = 2
    memory          = 2048
    disk_size       = 64

    network_model   = "virtio"
    network_bridge  = "vmbr0"
    network_vlan    = 2           
    network_mac     = "auto"       
    disk_type       = "scsi"
    ssd_emulation   = true
    onboot          = true
  },
  {
    name            = "k8s-worker1"
    vmid            = 161
    node            = "work4"
    storage         = "pve4-nvme-1"
    cores           = 4
    memory          = 4096
    disk_size       = 100

    network_model   = "virtio"
    network_bridge  = "vmbr0"
    network_vlan    = 2
    network_mac     = "auto"
    disk_type       = "scsi"
    ssd_emulation   = true
    onboot          = true
  },
  {
    name            = "k8s-worker2"
    vmid            = 162
    node            = "work5"
    storage         = "pve5-nvme-1"
    cores           = 2
    memory          = 2048
    disk_size       = 100

    network_model   = "virtio"
    network_bridge  = "vmbr0"
    network_vlan    = 2
    network_mac     = "auto"
    disk_type       = "scsi"
    ssd_emulation   = true
    onboot          = true
  },
  {
    name            = "k8s-worker3"
    vmid            = 161
    node            = "work1"
    storage         = "pve1-nvme-1"
    cores           = 4
    memory          = 4096
    disk_size       = 100

    network_model   = "virtio"
    network_bridge  = "vmbr0"
    network_vlan    = 2
    network_mac     = "auto"
    disk_type       = "scsi"
    ssd_emulation   = true
    onboot          = true
  }
]
